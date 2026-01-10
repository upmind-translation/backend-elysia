import OpenAI from "openai";
import { translationPrompt } from "./ai-promp/v3";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const translate = async (context: string) => {
  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: translationPrompt.system }],
      },
      {
        role: "developer",
        content: [{ type: "input_text", text: translationPrompt.developer }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: `# ${context}` }],
      },
    ],
    text: { format: { type: "text" }, verbosity: "low" },
    reasoning: { effort: "low" },
    max_output_tokens: 1500,
  });

  return response;
};
