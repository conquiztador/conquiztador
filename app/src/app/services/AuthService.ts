import axios from "axios";
import { z } from "zod";

import { environment } from "src/environments/environment";

const TOKEN_KEY = "conquiztador.token";

const TokenResponse = z.object({ token: z.string() });

/** Field-level problems the register form can show. */
export type RegisterProblem = "email" | "username" | "password";

export class LoginFailedError extends Error {}
export class RegisterFailedError extends Error {
    constructor(readonly problems: RegisterProblem[]) {
        super("Registration failed");
    }
}

export function savedToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

function saveToken(token: string | null) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch {
        // Not persisted: the player logs in again next visit.
    }
}

/** Exchanges email + password for a REST token and remembers it. */
export async function login(email: string, password: string): Promise<string> {
    try {
        const response = await axios.post(`${environment.apiUrl}/token/`, {
            email,
            password,
        });
        const { token } = TokenResponse.parse(response.data);
        saveToken(token);
        return token;
    } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 400)
            throw new LoginFailedError();
        throw e;
    }
}

/** Creates an account, then logs in. */
export async function register(
    email: string,
    password: string,
    username: string
): Promise<string> {
    try {
        await axios.post(`${environment.apiUrl}/users/`, {
            email,
            password,
            username: username.trim() || null,
        });
    } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 400) {
            const fields = Object.keys(e.response.data ?? {});
            const problems = ([
                "email",
                "username",
                "password",
            ] as const).filter((f) => fields.includes(f));
            throw new RegisterFailedError(
                problems.length ? problems : ["email"]
            );
        }
        throw e;
    }
    return login(email, password);
}

export function logout(): void {
    saveToken(null);
}
