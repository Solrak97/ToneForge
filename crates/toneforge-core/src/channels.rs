use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelDef {
    pub index: u8,
    pub label: String,
}

/// Channel slots exposed in Boss Tone Studio for each Katana Gen 3 model family.
pub fn channels_for_model_code(code: u8) -> Vec<ChannelDef> {
    match code {
        // Katana-50 Gen3 / 50 EX — panel + two user channels (no A/B bank UI on amp)
        0x05 | 0x0A => katana_50_channels(),
        // Full-size heads/combos — panel + bank A (4) + bank B (4)
        0x06 | 0x07 | 0x08 | 0x09 | 0x0B => katana_full_channels(),
        _ => katana_50_channels(),
    }
}

pub fn default_channels() -> Vec<ChannelDef> {
    katana_50_channels()
}

fn katana_50_channels() -> Vec<ChannelDef> {
    vec![
        channel(0, "PANEL"),
        channel(1, "CH1"),
        channel(2, "CH2"),
    ]
}

fn katana_full_channels() -> Vec<ChannelDef> {
    vec![
        channel(0, "PANEL"),
        channel(1, "A: CH1"),
        channel(2, "A: CH2"),
        channel(3, "A: CH3"),
        channel(4, "A: CH4"),
        channel(5, "B: CH1"),
        channel(6, "B: CH2"),
        channel(7, "B: CH3"),
        channel(8, "B: CH4"),
    ]
}

fn channel(index: u8, label: &str) -> ChannelDef {
    ChannelDef {
        index,
        label: label.to_string(),
    }
}

pub fn channel_label(channels: &[ChannelDef], index: u8) -> String {
    channels
        .iter()
        .find(|c| c.index == index)
        .map(|c| c.label.clone())
        .unwrap_or_else(|| format!("CH {}", index + 1))
}

pub fn is_valid_channel(channels: &[ChannelDef], index: u8) -> bool {
    channels.iter().any(|c| c.index == index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn katana_50_has_three_channels() {
        let ch = channels_for_model_code(0x05);
        assert_eq!(ch.len(), 3);
        assert_eq!(ch[1].label, "CH1");
    }

    #[test]
    fn katana_100_has_nine_channels() {
        assert_eq!(channels_for_model_code(0x06).len(), 9);
    }
}
