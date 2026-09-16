/** Shared wire contract. Never put credentials into messages or captured context. */
export const PROVIDERS = {
  openai: { label: 'OpenAI · Astra', model: 'gpt-6-astra' },
  openrouter: { label: 'OpenRouter', model: 'openai/gpt-6-astra' },
  anthropic: { label: 'Anthropic · Claude', model: 'claude-sonnet-5' },
  xai: { label: 'xAI · Grok', model: 'grok-4.6' },
  kimi: { label: 'Moonshot · Kimi', model: 'kimi-k2.5' },
  cursor: { label: 'Cursor · repository handoff', model: 'default' },
} as const;
export type Provider = keyof typeof PROVIDERS;
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  calls?: ToolCall[];
  callId?: string;
  reasoning?: Array<{
    type: 'reasoning';
    id: string;
    encrypted_content?: string;
    summary: unknown[];
  }>;
}
export interface AgentReply {
  text: string;
  calls: ToolCall[];
  reasoning?: AgentMessage['reasoning'];
  usage?: { input: number; output: number };
}
export const OPERATIONS = [
  'inspect_state',
  'lookup_controls',
  'set_visual_params',
  'set_view',
  'set_soundscape',
  'set_journey',
  'set_menu',
  'validate_controls',
  'measure_frames',
  'lookup_source',
  'run_tests',
  'record_handoff',
  'create_visualizer',
] as const;
export type Operation = (typeof OPERATIONS)[number];
export const STUDIO_TOOL = {
  name: 'studio_tool',
  description:
    'Inspect or operate Cybernoetica. Payload is a JSON object serialized as a string; see the system instructions for each operation. Operations are validated by the app.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: OPERATIONS },
      payload: {
        type: 'string',
        description: 'A JSON object encoded as a string.',
      },
    },
    required: ['operation', 'payload'],
    additionalProperties: false,
  },
};
export function parseTool(call: ToolCall): {
  operation: Operation;
  payload: Record<string, unknown>;
} {
  if (call.name !== 'studio_tool' || call.arguments.length > 40000)
    throw new Error('Unsupported tool call.');
  const args = JSON.parse(call.arguments);
  if (!OPERATIONS.includes(args.operation) || typeof args.payload !== 'string')
    throw new Error('Invalid tool operation.');
  const payload = JSON.parse(args.payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Tool payload must be an object.');
  return { operation: args.operation, payload };
}
