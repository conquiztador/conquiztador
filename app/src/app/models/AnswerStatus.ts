import { z } from "zod";

export const AnswerStatusSchema = z
    .object({
        is_correct: z.boolean(),
    })
    .transform(({ is_correct }) => ({ isCorrect: is_correct }));

export type AnswerStatus = z.infer<typeof AnswerStatusSchema>;
