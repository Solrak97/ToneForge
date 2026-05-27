use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SysExOp {
    Query = 0x11,
    Set = 0x12,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SysExMessage {
    pub device_id: Vec<u8>,
    pub op: SysExOp,
    pub address: [u8; 4],
    pub payload: Vec<u8>,
}

impl SysExMessage {
    pub fn to_bytes(&self) -> Vec<u8> {
        RolandSysExCodec::encode(self)
    }

    pub fn from_bytes(data: &[u8]) -> Result<Self, crate::CoreError> {
        RolandSysExCodec::decode(data)
    }
}

/// Roland 7-bit SysEx codec with checksum and chunked response reassembly.
pub struct RolandSysExCodec;

impl RolandSysExCodec {
    pub fn roland_checksum(payload: &[u8]) -> u8 {
        let mut accum = 0u8;
        for &byte in payload {
            accum = accum.wrapping_add(byte & 0x7F);
        }
        (128u8.wrapping_sub(accum)) & 0x7F
    }

    pub fn encode(message: &SysExMessage) -> Vec<u8> {
        let mut body = Vec::with_capacity(6 + message.payload.len());
        body.extend_from_slice(&message.device_id);
        body.push(message.op as u8);
        body.extend_from_slice(&message.address);
        body.extend_from_slice(&message.payload);

        let checksum = Self::roland_checksum(&body[message.device_id.len() + 1..]);
        let mut out = Vec::with_capacity(body.len() + 3);
        out.push(0xF0);
        out.extend_from_slice(&body);
        out.push(checksum);
        out.push(0xF7);
        out
    }

    pub fn encode_query(device_id: &[u8], address: [u8; 4], length: u32) -> Vec<u8> {
        Self::encode(&SysExMessage {
            device_id: device_id.to_vec(),
            op: SysExOp::Query,
            address,
            payload: Self::encode_u32_be7(length),
        })
    }

    pub fn encode_set(device_id: &[u8], address: [u8; 4], data: &[u8]) -> Vec<u8> {
        Self::encode(&SysExMessage {
            device_id: device_id.to_vec(),
            op: SysExOp::Set,
            address,
            payload: data.to_vec(),
        })
    }

    pub fn decode(data: &[u8]) -> Result<SysExMessage, crate::CoreError> {
        if data.len() < 8 {
            return Err(crate::CoreError::InvalidSysEx("message too short".into()));
        }
        if data[0] != 0xF0 || data.last().copied() != Some(0xF7) {
            return Err(crate::CoreError::InvalidSysEx(
                "missing F0/F7 framing".into(),
            ));
        }

        let inner = &data[1..data.len() - 2];
        let checksum = data[data.len() - 2];
        let op_index = inner.iter().position(|b| *b == 0x11 || *b == 0x12).ok_or_else(|| {
            crate::CoreError::InvalidSysEx("missing query/set opcode".into())
        })?;
        let checksum_payload = &inner[op_index + 1..];
        let expected = Self::roland_checksum(checksum_payload);
        if checksum != expected {
            return Err(crate::CoreError::ChecksumMismatch {
                expected,
                actual: checksum,
            });
        }

        let device_id = inner[..op_index].to_vec();
        let op = match inner[op_index] {
            0x11 => SysExOp::Query,
            0x12 => SysExOp::Set,
            _ => {
                return Err(crate::CoreError::InvalidSysEx(
                    "unknown opcode".into(),
                ));
            }
        };
        if checksum_payload.len() < 4 {
            return Err(crate::CoreError::InvalidSysEx(
                "missing address bytes".into(),
            ));
        }
        let address = [
            checksum_payload[0],
            checksum_payload[1],
            checksum_payload[2],
            checksum_payload[3],
        ];
        let payload = checksum_payload[4..].to_vec();

        Ok(SysExMessage {
            device_id,
            op,
            address,
            payload,
        })
    }

    pub fn encode_u32_be7(value: u32) -> Vec<u8> {
        vec![
            ((value >> 21) & 0x7F) as u8,
            ((value >> 14) & 0x7F) as u8,
            ((value >> 7) & 0x7F) as u8,
            (value & 0x7F) as u8,
        ]
    }

    pub fn decode_u32_be7(bytes: &[u8]) -> Option<u32> {
        if bytes.len() < 4 {
            return None;
        }
        Some(
            ((bytes[0] as u32) << 21)
                | ((bytes[1] as u32) << 14)
                | ((bytes[2] as u32) << 7)
                | (bytes[3] as u32),
        )
    }

    /// Roland `INTEGER2x4` encoding (high nibble, low nibble).
    pub fn encode_integer2x4(value: u8) -> [u8; 2] {
        [(value >> 4) & 0x7F, value & 0x0F]
    }

    pub fn decode_integer2x4(bytes: &[u8]) -> Option<u8> {
        if bytes.len() < 2 {
            return None;
        }
        Some((bytes[0] << 4) | (bytes[1] & 0x0F))
    }
}

/// Reassembles chunked Roland SysEx responses (~241 bytes payload per chunk).
#[derive(Debug, Default)]
pub struct SysExChunkAssembler {
    expected_address: Option<[u8; 4]>,
    buffer: Vec<u8>,
    chunks_received: u32,
    chunks_expected: Option<u32>,
}

impl SysExChunkAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn feed(&mut self, data: &[u8]) -> Result<Option<Vec<u8>>, crate::CoreError> {
        let message = RolandSysExCodec::decode(data)?;
        if message.op != SysExOp::Set {
            return Ok(None);
        }

        if self.expected_address.is_none() {
            self.expected_address = Some(message.address);
        }

        if message.payload.is_empty() {
            return Ok(None);
        }

        // First chunk may include a 4-byte total length header.
        if self.buffer.is_empty() && message.payload.len() >= 4 {
            if let Some(total) = RolandSysExCodec::decode_u32_be7(&message.payload[..4]) {
                self.chunks_expected = Some((total / 241).saturating_add(1));
                self.buffer.extend_from_slice(&message.payload[4..]);
            } else {
                self.buffer.extend_from_slice(&message.payload);
            }
        } else {
            self.buffer.extend_from_slice(&message.payload);
        }

        self.chunks_received += 1;

        let done = match self.chunks_expected {
            Some(expected) => self.chunks_received >= expected,
            None => message.payload.len() < 241,
        };

        if done {
            let result = std::mem::take(&mut self.buffer);
            self.reset();
            return Ok(Some(result));
        }

        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GEN3_DEVICE_ID: [u8; 5] = [0x41, 0x10, 0x01, 0x05, 0x07];

    #[test]
    fn checksum_matches_known_editor_mode_message() {
        let payload = [0x7F, 0x00, 0x00, 0x01, 0x01];
        assert_eq!(RolandSysExCodec::roland_checksum(&payload), 0x7F);
    }

    #[test]
    fn encode_editor_mode_message() {
        let bytes = RolandSysExCodec::encode_set(
            &GEN3_DEVICE_ID,
            [0x7F, 0x00, 0x00, 0x01],
            &[0x01],
        );
        assert_eq!(bytes.first(), Some(&0xF0));
        assert_eq!(bytes.last(), Some(&0xF7));
        assert!(bytes.windows(6).any(|w| w == [0x12, 0x7F, 0x00, 0x00, 0x01, 0x01]));
    }

    #[test]
    fn roundtrip_query_message() {
        let original = SysExMessage {
            device_id: GEN3_DEVICE_ID.to_vec(),
            op: SysExOp::Query,
            address: [0x00, 0x01, 0x00, 0x00],
            payload: RolandSysExCodec::encode_u32_be7(2),
        };
        let encoded = RolandSysExCodec::encode(&original);
        let decoded = RolandSysExCodec::decode(&encoded).expect("decode");
        assert_eq!(decoded.address, original.address);
        assert_eq!(decoded.op, SysExOp::Query);
        assert_eq!(decoded.payload, original.payload);
    }

    #[test]
    fn encode_u32_be7_patch_length() {
        assert_eq!(
            RolandSysExCodec::encode_u32_be7(0x1700),
            vec![0x00, 0x00, 0x2E, 0x00]
        );
    }

    #[test]
    fn integer2x4_roundtrip() {
        for value in 0..=9u8 {
            let encoded = RolandSysExCodec::encode_integer2x4(value);
            assert_eq!(
                RolandSysExCodec::decode_integer2x4(&encoded),
                Some(value)
            );
        }
        assert_eq!(RolandSysExCodec::encode_integer2x4(9), [0x00, 0x09]);
        assert_eq!(RolandSysExCodec::encode_integer2x4(10), [0x00, 0x0A]);
        assert_eq!(RolandSysExCodec::encode_integer2x4(16), [0x01, 0x00]);
    }

    #[test]
    fn chunk_assembler_combines_single_chunk() {
        let payload = RolandSysExCodec::encode_set(
            &GEN3_DEVICE_ID,
            [0x60, 0x00, 0x00, 0x00],
            &[0x01, 0x02, 0x03],
        );
        let mut assembler = SysExChunkAssembler::new();
        let result = assembler.feed(&payload).expect("feed");
        assert_eq!(result, Some(vec![0x01, 0x02, 0x03]));
    }
}
