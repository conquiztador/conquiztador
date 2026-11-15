import axios from "axios";

import { environment } from "src/environments/environment";
import { Question, QuestionSchema } from "models/Question";
import { AnswerStatus, AnswerStatusSchema } from "models/AnswerStatus";

export class QuestionService {
    async readRandomQuestion(): Promise<Question> {
        const response = await axios.get(
            `${environment.apiUrl}/questions/random/`
        );

        return QuestionSchema.parse(response.data);
    }

    async validateAnswer(
        question: Question,
        answerIndex: number
    ): Promise<AnswerStatus> {
        const response = await axios.post(
            `${environment.apiUrl}/questions/${question.uuid}/validate-answer/`,
            { uuid: question.answers[answerIndex].uuid }
        );

        return AnswerStatusSchema.parse(response.data);
    }
}
