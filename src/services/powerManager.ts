// ============================================================================
// Power Manager — Adaptive power management for battery conservation
//
// Monitors battery level and automatically adjusts app behavior:
//   Full (>30%):     All features active, high refresh
//   Balanced (15-30%): Disable amplitude metering, reduce polling
//   Saver (<15%):    Minimal features, no camera, longer intervals
// ============================================================================

import * as Battery from 'expo-battery';
import { Platform } from 'react-native';

export type PowerMode = 'full' | 'balanced' | 'saver';

interface PowerState {
  mode: PowerMode;
  batteryLevel: number;
  isCharging: boolean;
}

type PowerModeCallback = (mode: PowerMode) => void;

export class PowerManager {
  private _state: PowerState = { mode: 'full', batteryLevel: 1, isCharging: false };
  private _callbacks: PowerModeCallback[] = [];
  private _subscription: Battery.Subscription | null = null;
  private _active = false;

  get state(): PowerState { return { ...this._state }; }
  get mode(): PowerMode { return this._state.mode; }

  async start(): Promise<void> {
    if (this._active) return;
    this._active = true;

    // Get initial state
    try {
      const [level, charging] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
      ]);
      this._state.batteryLevel = level;
      this._state.isCharging = charging === Battery.BatteryState.CHARGING || charging === Battery.BatteryState.FULL;
      this._updateMode();
    } catch {
      // Battery API may not be available (simulator)
    }

    // Subscribe to battery changes
    try {
      this._subscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
        this._state.batteryLevel = batteryLevel;
        this._updateMode();
      });
    } catch {
      // Non-fatal
    }
  }

  stop(): void {
    this._active = false;
    this._subscription?.remove();
    this._subscription = null;
  }

  onModeChange(cb: PowerModeCallback): () => void {
    this._callbacks.push(cb);
    return () => { this._callbacks = this._callbacks.filter(c => c !== cb); };
  }

  /** Get recommended settings for current power mode */
  getRecommendations(): {
    enableAmplitude: boolean;
    enableCamera: boolean;
    silenceTimeoutMs: number;
    captionRefreshMs: number;
  } {
    switch (this._state.mode) {
      case 'full':
        return {
          enableAmplitude: true,
          enableCamera: true,
          silenceTimeoutMs: 1500,
          captionRefreshMs: 100,
        };
      case 'balanced':
        return {
          enableAmplitude: false,
          enableCamera: true,
          silenceTimeoutMs: 2000,
          captionRefreshMs: 200,
        };
      case 'saver':
        return {
          enableAmplitude: false,
          enableCamera: false,
          silenceTimeoutMs: 3000,
          captionRefreshMs: 500,
        };
    }
  }

  private _updateMode(): void {
    const { batteryLevel, isCharging } = this._state;

    // Always full when charging
    let newMode: PowerMode = 'full';
    if (!isCharging) {
      if (batteryLevel < 0.15) newMode = 'saver';
      else if (batteryLevel < 0.30) newMode = 'balanced';
    }

    if (newMode !== this._state.mode) {
      const oldMode = this._state.mode;
      this._state.mode = newMode;
      console.log(`[PowerManager] ${oldMode} → ${newMode} (battery: ${Math.round(batteryLevel * 100)}%)`);
      for (const cb of this._callbacks) cb(newMode);
    }
  }
}

// Singleton
let _instance: PowerManager | null = null;

export function getPowerManager(): PowerManager {
  if (!_instance) _instance = new PowerManager();
  return _instance;
}
