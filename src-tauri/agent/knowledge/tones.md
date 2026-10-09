# ToneForge tone recipes (Katana Gen 3)

## overview
Always batch with `set_params`. Amp types: 0 Acoustic, 1 Clean, 2 Pushed, 3 Crunch, 4 Lead, 5 Brown.
FX types (slot1): 3 Comp, 8 Slow Gear, 9 Wave Synth, 23 Chorus (2x2). Booster Metal Core = 21.

## post-rock
```
patch_amp_type=2, patch_amp_gain=42, patch_amp_volume=USER_VOL,
patch_sw_mod_sw=1, patch_fx_type_slot1=23,
patch_fx_detail_2x2chorus_direct_mix_slot1=90,
patch_sw_delay_sw=1, patch_delay_type_slot1=0, patch_delay_time_slot1=680,
patch_delay_effect_level_slot1=48, patch_delay_feedback_slot1=52, patch_delay_mod_sw_slot1=0,
patch_sw_reverb_sw=1, patch_reverb_type_slot1=2, patch_reverb_effect_level_slot1=58, patch_reverb_time_slot1=68,
patch_ns_sw=0, patch_sw_booster_sw=0, patch_sw_fx_sw=0
```

## pink-floyd
Comfortably Numb solo:
```
patch_amp_type=4, patch_amp_gain=58, patch_amp_volume=USER_VOL,
patch_amp_bass=56, patch_amp_middle=70, patch_amp_treble=48, patch_amp_presence=42,
patch_sw_mod_sw=1, patch_fx_type_slot1=3,
patch_fx_detail_comp_sustain_slot1=72, patch_fx_detail_comp_attack_slot1=30, patch_fx_detail_comp_level_slot1=90,
patch_sw_delay_sw=1, patch_delay_type_slot1=0, patch_delay_time_slot1=560,
patch_delay_effect_level_slot1=38, patch_delay_feedback_slot1=42, patch_delay_mod_sw_slot1=0,
patch_sw_reverb_sw=1, patch_reverb_type_slot1=2, patch_reverb_effect_level_slot1=28,
patch_ns_sw=0, patch_sw_booster_sw=0
```

## opeth
Cusp solo:
```
patch_amp_type=4, patch_amp_gain=64, patch_amp_volume=USER_VOL, patch_amp_middle=70,
patch_sw_mod_sw=1, patch_fx_type_slot1=3,
patch_sw_delay_sw=1, patch_delay_type_slot1=0, patch_delay_time_slot1=420,
patch_delay_effect_level_slot1=28, patch_delay_mod_sw_slot1=0,
patch_sw_reverb_sw=1, patch_reverb_type_slot1=2, patch_reverb_effect_level_slot1=26,
patch_ns_sw=1, patch_ns_threshold=38, patch_ns_release=68
```

Ghost of Perdition heavy:
```
patch_amp_type=5, patch_amp_gain=78, patch_amp_volume=USER_VOL, patch_amp_middle=72,
patch_sw_booster_sw=1, patch_booster_type_slot1=21, patch_booster_drive_slot1=36,
patch_sw_mod_sw=0, patch_sw_delay_sw=0,
patch_sw_reverb_sw=1, patch_reverb_effect_level_slot1=16,
patch_ns_sw=1, patch_ns_threshold=62
```

## jazz
```
patch_amp_type=1, patch_amp_gain=32, patch_amp_volume=USER_VOL,
patch_amp_bass=60, patch_amp_middle=66, patch_amp_treble=40, patch_amp_presence=34,
patch_sw_booster_sw=0, patch_sw_mod_sw=1, patch_fx_type_slot1=3,
patch_sw_delay_sw=1, patch_delay_type_slot1=0, patch_delay_time_slot1=280,
patch_delay_effect_level_slot1=16, patch_delay_mod_sw_slot1=0,
patch_sw_reverb_sw=1, patch_reverb_type_slot1=3, patch_reverb_effect_level_slot1=28,
patch_ns_sw=0
```

## king-crimson
Muted synth intro:
```
patch_amp_type=1, patch_amp_gain=28, patch_amp_volume=USER_VOL,
patch_amp_treble=28, patch_amp_presence=24,
patch_sw_mod_sw=1, patch_fx_type_slot1=9,
patch_fx_detail_wavesynth_cutoff_slot1=26, patch_fx_detail_wavesynth_synth_level_slot1=72,
patch_fx_detail_wavesynth_direct_mix_slot1=18,
patch_sw_fx_sw=1, patch_fx_type_slot4=8,
patch_sw_delay_sw=0,
patch_sw_reverb_sw=1, patch_reverb_type_slot1=2, patch_reverb_effect_level_slot1=38,
patch_ns_sw=0
```

## dreamy
```
patch_amp_type=4, patch_amp_gain=54, patch_amp_volume=USER_VOL, patch_amp_middle=68,
patch_sw_mod_sw=1, patch_fx_type_slot1=3,
patch_sw_delay_sw=1, patch_delay_type_slot1=0, patch_delay_time_slot1=480,
patch_delay_effect_level_slot1=34, patch_delay_mod_sw_slot1=0,
patch_sw_reverb_sw=1, patch_reverb_type_slot1=2, patch_reverb_effect_level_slot1=40,
patch_ns_sw=1, patch_ns_threshold=48
```
