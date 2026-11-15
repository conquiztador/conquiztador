import { z } from "zod";

import { AnswerSchema } from "./Answer";

export const QuestionSchema = z
    .object({
        uuid: z.string(),
        url: z.string(),
        text: z.string(),
        answers: z.array(AnswerSchema),
        updated_at: z.coerce.date(),
        created_at: z.coerce.date(),
    })
    .transform(({ updated_at, created_at, ...rest }) => ({
        ...rest,
        updatedAt: updated_at,
        createdAt: created_at,
    }));

export type Question = z.infer<typeof QuestionSchema>;
