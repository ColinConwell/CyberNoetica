import type { AudioSource, AudioSourceType } from '@cybernoetica/audio';
import type { PlaybackStateMachine } from './playback-state.js';

/** One transaction owns both the source commit and its playback/UI updates. */
export class SourceController {
  private generation = 0;

  constructor(
    private source: AudioSource,
    private playback: PlaybackStateMachine,
    private onReady: (name: string, type: AudioSourceType) => void,
    private onError: (message: string) => void,
  ) {}

  get revision(): number {
    return this.generation;
  }
  cancel(): void {
    this.generation++;
    this.source.cancelPendingLoad();
  }

  async select(
    name: string,
    type: AudioSourceType,
    load: () => Promise<boolean> | boolean,
  ): Promise<boolean> {
    const generation = ++this.generation;
    this.source.cancelPendingLoad();
    if (this.playback.isIdle) this.playback.dispatch({ type: 'START' });
    else this.playback.dispatch({ type: 'SWITCH_SOURCE', source: type });
    try {
      if (type !== 'none') await this.source.resume();
      if (generation !== this.generation) return false;
      const loaded = await load();
      if (!loaded || generation !== this.generation) return false;
      this.playback.dispatch({
        type:
          this.playback.state === 'switching-source'
            ? 'SOURCE_READY'
            : 'LOADED',
      });
      this.onReady(name, type);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.playback.dispatch({ type: 'ERROR' });
      this.onError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}
