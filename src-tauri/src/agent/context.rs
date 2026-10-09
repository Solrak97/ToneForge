//! System prompt, session context, history truncation, knowledge packs.

use super::provider::ChatMessage;
use super::settings::AgentSettings;
use super::tools;
use serde_json::Value;

const MAX_HISTORY_MESSAGES: usize = 24;

pub const GENRES_KNOWLEDGE: &str = include_str!("../../agent/knowledge/genres.md");
pub const TONES_KNOWLEDGE: &str = include_str!("../../agent/knowledge/tones.md");

pub fn build_system_prompt(settings: &AgentSettings, snapshot: &Value, knowledge: &str) -> String {
    let prefs = &settings.preferences;
    format!(
        r#"You are ToneForge Agent, an expert guitar tone designer for Boss Katana Gen 3.

You control the amp through tools. Prefer applying a full tone with a single set_params call (tone recipe).

## Safety rules
- Never set pitch shifter direct_mix to 0 (silences the guitar). Keep direct_mix at 100 unless intentionally blending.
- Prefer digital delay (patch_delay_type_slot1 = 0) with delay mod OFF for clean/atmospheric tones. Avoid tape echo wow/flutter unless asked.
- Respect the user's preferred volume range: {vol_min}-{vol_max}.
- Avoid wobble FX (heavy chorus, delay mod, vibrato, tremolo) when avoid_wobble is enabled: {avoid_wobble}.
- After changing tones, briefly describe what you set. Ask before extreme volume jumps.

## Amp type enum (patch_amp_type)
0 Acoustic, 1 Clean, 2 Pushed, 3 Crunch, 4 Lead, 5 Brown

## User preferences
{prefs_notes}

## Live session
{snapshot}

## Relevant tone knowledge
{knowledge}
"#,
        vol_min = prefs.preferred_volume_min,
        vol_max = prefs.preferred_volume_max,
        avoid_wobble = prefs.avoid_wobble_fx,
        prefs_notes = if prefs.notes.trim().is_empty() {
            "(none)".into()
        } else {
            prefs.notes.clone()
        },
        snapshot = serde_json::to_string_pretty(snapshot).unwrap_or_else(|_| "{}".into()),
        knowledge = if knowledge.trim().is_empty() {
            "(none matched)"
        } else {
            knowledge
        },
    )
}

pub async fn live_snapshot_json() -> Value {
    let map = tools::session_snapshot().await;
    Value::Object(map.into_iter().collect())
}

pub fn select_knowledge(user_text: &str) -> String {
    let lower = user_text.to_lowercase();
    let mut parts = Vec::new();

    let genre_hits = [
        ("post-rock", "post-rock"),
        ("post rock", "post-rock"),
        ("astronaut", "post-rock"),
        ("shoegaze", "shoegaze"),
        ("floyd", "pink-floyd"),
        ("gilmour", "pink-floyd"),
        ("comfortably numb", "pink-floyd"),
        ("opeth", "opeth"),
        ("ghost of perdition", "opeth"),
        ("cusp", "opeth"),
        ("jazz", "jazz"),
        ("metal", "metal"),
        ("egyptian", "egyptian-metal"),
        ("starless", "king-crimson"),
        ("epitaph", "king-crimson"),
        ("crimson", "king-crimson"),
        ("synth", "synth"),
        ("dream", "dreamy"),
        ("ambient", "ambient"),
    ];

    let mut matched_tags = Vec::new();
    for (needle, tag) in genre_hits {
        if lower.contains(needle) && !matched_tags.contains(&tag) {
            matched_tags.push(tag);
        }
    }

    if matched_tags.is_empty() {
        // Default short overview
        parts.push(excerpt_sections(GENRES_KNOWLEDGE, &["overview"], 1200));
        parts.push(excerpt_sections(TONES_KNOWLEDGE, &["overview"], 1200));
    } else {
        parts.push(excerpt_sections(GENRES_KNOWLEDGE, &matched_tags, 2500));
        parts.push(excerpt_sections(TONES_KNOWLEDGE, &matched_tags, 2500));
    }

    parts.into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join("\n\n")
}

fn excerpt_sections(doc: &str, tags: &[&str], max_chars: usize) -> String {
    let mut out = String::new();
    for tag in tags {
        let header = format!("## {tag}");
        // also try title-case variants in the md
        let alt = format!("## {}", titleish(tag));
        if let Some(section) = extract_section(doc, &header).or_else(|| extract_section(doc, &alt))
        {
            if !out.is_empty() {
                out.push_str("\n\n");
            }
            out.push_str(&section);
        }
    }
    if out.is_empty() && tags.contains(&"overview") {
        // First chunk of the doc
        out.push_str(&doc.chars().take(max_chars).collect::<String>());
    }
    if out.chars().count() > max_chars {
        out = out.chars().take(max_chars).collect();
        out.push_str("\n…");
    }
    out
}

fn titleish(tag: &str) -> String {
    tag.split(|c: char| c == '-' || c == '_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_section(doc: &str, header: &str) -> Option<String> {
    let start = doc.find(header)?;
    let rest = &doc[start..];
    let end = rest[header.len()..]
        .find("\n## ")
        .map(|i| header.len() + i)
        .unwrap_or(rest.len());
    Some(rest[..end].trim().to_string())
}

pub fn truncate_history(messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    if messages.len() <= MAX_HISTORY_MESSAGES {
        return messages;
    }
    // Keep system (if any) + last N
    let mut system = Vec::new();
    let mut rest = Vec::new();
    for m in messages {
        if m.role == "system" && system.is_empty() {
            system.push(m);
        } else {
            rest.push(m);
        }
    }
    let skip = rest.len().saturating_sub(MAX_HISTORY_MESSAGES.saturating_sub(system.len()));
    system.extend(rest.into_iter().skip(skip));
    system
}
