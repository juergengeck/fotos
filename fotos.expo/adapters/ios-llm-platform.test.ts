import {describe, expect, it, vi} from 'vitest';
import type {AIPlanEventEmitter} from '@refinio/agent.core/services/ai-plan-events.js';
import {Events} from '@vger/vger.core/events';

const mocks = vi.hoisted(() => ({emit: vi.fn()}));
vi.mock('react-native', () => ({DeviceEventEmitter: {emit: mocks.emit}}));
vi.mock('../ios-ui/modules/LocalModelModule', () => ({AVAILABLE_MODELS: []}));

import {IOSLLMPlatform} from './ios-llm-platform';

describe('iOS AI plan events', () => {
  it('delivers persisted default-model and contact changes to native UI listeners', () => {
    const platform: AIPlanEventEmitter = new IOSLLMPlatform();
    const payload = {modelId: 'local-model', modelName: 'Local model'};

    platform.emitDefaultModelChanged(payload);
    platform.emitContactsUpdated();

    expect(mocks.emit.mock.calls).toEqual([
      [Events.AI_DEFAULT_MODEL_CHANGED, payload],
      [Events.CONTACTS_UPDATED, {}],
    ]);
  });
});
