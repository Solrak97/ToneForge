use crate::error::DeviceError;
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use toneforge_core::sysex::RolandSysExCodec;
use tracing::{debug, info, warn};

pub struct MidiTransport {
    input: Option<MidiInputConnection<()>>,
    output: Option<MidiOutputConnection>,
    inbox: Arc<(Mutex<Vec<Vec<u8>>>, Condvar)>,
    port_name: Option<String>,
}

impl MidiTransport {
    pub fn list_ports() -> Result<Vec<(String, String)>, DeviceError> {
        let midi_in = MidiInput::new("toneforge-scan-in").map_err(|e| DeviceError::Midi(e.to_string()))?;
        let midi_out = MidiOutput::new("toneforge-scan-out").map_err(|e| DeviceError::Midi(e.to_string()))?;

        let mut ports = Vec::new();
        for (idx, name) in midi_in.ports().iter().enumerate() {
            let port_name = midi_in
                .port_name(name)
                .map_err(|e| DeviceError::Midi(e.to_string()))?;
            ports.push((format!("in:{idx}"), port_name));
        }
        for (idx, name) in midi_out.ports().iter().enumerate() {
            let port_name = midi_out
                .port_name(name)
                .map_err(|e| DeviceError::Midi(e.to_string()))?;
            ports.push((format!("out:{idx}"), port_name));
        }
        Ok(ports)
    }

    pub fn list_unique_devices() -> Result<Vec<String>, DeviceError> {
        let ports = Self::list_ports()?;
        let mut names: Vec<String> = ports
            .into_iter()
            .map(|(_, name)| name)
            .filter(|name| is_katana_candidate(name))
            .collect();
        names.sort();
        names.dedup();
        debug!(count = names.len(), ports = ?names, "MIDI port scan complete");
        Ok(names)
    }

    pub fn connect(port_name: &str) -> Result<Self, DeviceError> {
        let inbox = Arc::new((Mutex::new(Vec::new()), Condvar::new()));
        let inbox_cb = Arc::clone(&inbox);

        let mut midi_in = MidiInput::new("toneforge-in").map_err(|e| DeviceError::Midi(e.to_string()))?;
        midi_in.ignore(Ignore::TimeAndActiveSense);

        let input_port = midi_in
            .ports()
            .into_iter()
            .find(|p| {
                midi_in
                    .port_name(p)
                    .map(|n| n == port_name)
                    .unwrap_or(false)
            })
            .ok_or_else(|| DeviceError::NotFound(port_name.to_string()))?;

        let input = midi_in
            .connect(
                &input_port,
                "toneforge-input",
                move |_stamp, message, _| {
                    if message.first() == Some(&0xF0) {
                        if let Some(end) = message.iter().position(|&b| b == 0xF7) {
                            let frame = message[..=end].to_vec();
                            let (lock, cvar) = &*inbox_cb;
                            let mut queue = lock.lock().expect("inbox lock");
                            queue.push(frame);
                            cvar.notify_all();
                        }
                    }
                },
                (),
            )
            .map_err(|e| DeviceError::Midi(e.to_string()))?;

        let midi_out = MidiOutput::new("toneforge-out").map_err(|e| DeviceError::Midi(e.to_string()))?;
        let output_port = midi_out
            .ports()
            .into_iter()
            .find(|p| {
                midi_out
                    .port_name(p)
                    .map(|n| n == port_name)
                    .unwrap_or(false)
            })
            .ok_or_else(|| DeviceError::NotFound(port_name.to_string()))?;

        let output = midi_out
            .connect(&output_port, "toneforge-output")
            .map_err(|e| DeviceError::Midi(e.to_string()))?;

        info!(port = %port_name, "MIDI transport connected");
        Ok(Self {
            input: Some(input),
            output: Some(output),
            inbox,
            port_name: Some(port_name.to_string()),
        })
    }

    pub fn port_name(&self) -> Option<&str> {
        self.port_name.as_deref()
    }

    pub fn send_sysex(&mut self, data: &[u8]) -> Result<(), DeviceError> {
        let output = self
            .output
            .as_mut()
            .ok_or(DeviceError::NotConnected)?;
        debug!(bytes = data.len(), sysex = %hex_sysex(data), "MIDI TX");
        output
            .send(data)
            .map_err(|e| DeviceError::Midi(e.to_string()))
    }

    pub fn request_response(
        &mut self,
        request: &[u8],
        timeout: Duration,
    ) -> Result<Vec<u8>, DeviceError> {
        self.clear_inbox();
        self.send_sysex(request)?;

        let deadline = Instant::now() + timeout;
        loop {
            if let Some(response) = self.wait_sysex(deadline)? {
                debug!(bytes = response.len(), sysex = %hex_sysex(&response), "MIDI RX response");
                return Ok(response);
            }
            if Instant::now() >= deadline {
                warn!("MIDI request_response timed out");
                return Err(DeviceError::Timeout);
            }
        }
    }

    pub fn request_block(
        &mut self,
        request: &[u8],
        timeout: Duration,
    ) -> Result<Vec<u8>, DeviceError> {
        use toneforge_core::sysex::SysExChunkAssembler;

        self.clear_inbox();
        self.send_sysex(request)?;

        let mut assembler = SysExChunkAssembler::new();
        let deadline = Instant::now() + timeout;

        while Instant::now() < deadline {
            if let Some(frame) = self.wait_sysex(deadline)? {
                debug!(bytes = frame.len(), sysex = %hex_sysex(&frame), "MIDI RX chunk");
                if let Some(block) = assembler.feed(&frame)? {
                    info!(block_bytes = block.len(), "MIDI patch block assembled");
                    return Ok(block);
                }
            }
        }

        warn!("MIDI request_block timed out");
        Err(DeviceError::Timeout)
    }

    /// Universal Device Identity Inquiry (not Roland DT1/RQ1).
    pub fn query_identity(&mut self, timeout: Duration) -> Result<Option<u8>, DeviceError> {
        const IDENTITY_REQUEST: [u8; 6] = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7];
        let response = self.request_response(&IDENTITY_REQUEST, timeout)?;
        Ok(parse_identity_model_code(&response))
    }

    fn clear_inbox(&self) {
        let (lock, _) = &*self.inbox;
        lock.lock().expect("inbox lock").clear();
    }

    fn wait_sysex(&self, deadline: Instant) -> Result<Option<Vec<u8>>, DeviceError> {
        let (lock, cvar) = &*self.inbox;
        let mut queue = lock.lock().expect("inbox lock");
        while queue.is_empty() {
            let now = Instant::now();
            if now >= deadline {
                return Ok(None);
            }
            let remaining = deadline.saturating_duration_since(now);
            let (guard, timeout_result) = cvar
                .wait_timeout(queue, remaining)
                .expect("condvar wait");
            queue = guard;
            if timeout_result.timed_out() && queue.is_empty() {
                return Ok(None);
            }
        }
        let next = queue.drain(..1).next();
        Ok(next)
    }
}

impl Drop for MidiTransport {
    fn drop(&mut self) {
        self.input = None;
        self.output = None;
    }
}

pub fn is_katana_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("katana") || lower.contains("boss")
}

fn parse_identity_model_code(response: &[u8]) -> Option<u8> {
    if response.len() < 11 {
        return None;
    }
    if response.first() != Some(&0xF0)
        || response.get(3) != Some(&0x06)
        || response.get(4) != Some(&0x02)
    {
        return None;
    }
    // Boss Tone Studio reads the model id from this byte in the identity reply.
    response.get(10).copied()
}

pub(crate) fn hex_sysex(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn encode_scalar(value: u32) -> [u8; 4] {
    let bytes = RolandSysExCodec::encode_u32_be7(value);
    [bytes[0], bytes[1], bytes[2], bytes[3]]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn katana_name_detection() {
        assert!(is_katana_candidate("KATANA"));
        assert!(is_katana_candidate("BOSS Katana Gen3"));
        assert!(!is_katana_candidate("Focusrite USB"));
    }
}
