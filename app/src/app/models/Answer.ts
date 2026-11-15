import { z } from "zod";

export const AnswerSchema = z.object({
    uuid: z.string(),
    text: z.string(),
});

export type Answer = z.infer<typeof AnswerSchema>;
