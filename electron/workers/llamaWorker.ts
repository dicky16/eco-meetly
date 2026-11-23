type LlamaRequest = {
  id: string;
  modelPath: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  topK: number;
  topP: number;
};

// Preserve native ESM import() even when compiled to CommonJS by TypeScript
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<typeof import('node-llama-cpp')>;

function send(msg: Record<string, unknown>): void {
  if (process.send) {
    process.send(msg);
  }
}

process.on('message', async (req: LlamaRequest) => {
  try {
    const { getLlama, LlamaChatSession } = await nativeImport('node-llama-cpp');
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: req.modelPath });
    const context = await model.createContext({ contextSize: 4096 });

    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: req.systemPrompt,
      });

      let streamed = '';
      const response = await session.prompt(req.userPrompt, {
        temperature: req.temperature,
        topK: req.topK,
        topP: req.topP,
        onTextChunk: (chunk: string) => {
          streamed += chunk;
          send({ type: 'token', reqId: req.id, token: chunk });
        },
      });

      const finalContent = (response || streamed).trim();
      if (!finalContent) {
        send({ type: 'error', reqId: req.id, error: 'Model generated an empty response.' });
        return;
      }
      send({ type: 'result', reqId: req.id, content: finalContent });
    } finally {
      await context.dispose();
      await model.dispose();
    }
  } catch (err) {
    send({
      type: 'error',
      reqId: req.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
