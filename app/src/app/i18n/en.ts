/**
 * English UI text. This file defines the shape of `Messages`; every other
 * language must provide the same keys (TypeScript enforces it).
 *
 * Messages that depend on who acts or on a count are functions, so each
 * language can get its own grammar (verb forms, plurals) right.
 */

/** Someone a sentence talks about: the local player ("you") or another. */
export interface Who {
    name: string;
    you: boolean;
}

const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

export const en = {
    languageName: "English",
    switchLanguage: "Switch to Bulgarian · Превключи на български",

    menu: {
        title: "Conquiztador",
        tagline: "Conquer Bulgaria, one question at a time",
        newGame: "New game",
        multiplayer: "Multiplayer",
    },

    account: {
        login: "Log in",
        register: "Create account",
        logout: "Log out",
        email: "Email",
        password: "Password",
        username: "Player name (optional)",
        haveAccount: "Already have an account? Log in",
        noAccount: "New here? Create an account",
        loginFailed: "Wrong email or password.",
        emailProblem: "That email is invalid or already registered.",
        usernameProblem: "That player name is taken or invalid.",
        passwordProblem: "Choose a different password.",
        serverUnreachable: "Can't reach the server. Try again later.",
        loggedInAs: (name: string) => `Logged in as ${name}`,
        points: (n: string) => `${n} points`,
        back: "Back",
    },

    rooms: {
        title: "Rooms",
        create: "Create room",
        none: "No rooms yet. Create one!",
        join: "Join",
        full: "Full",
        locked: "Locked",
        playing: "Playing",
        byAuthor: (name: string) => `by ${name}`,
        seats: (filled: number, total: number) => `${filled}/${total}`,
        rounds: (n: number) => `${n} rounds`,
        protected: "Password protected",
        name: "Room name",
        defaultName: (player: string) => `${player}'s room`,
        passwordOptional: "Password (optional)",
        enterPassword: "This room needs a password",
        cancel: "Cancel",
        connecting: "Connecting…",
        disconnected: "Lost connection to the game server.",
        reconnect: "Reconnect",
        replaced: "You opened the game in another window.",
        reconnecting: "Connection lost — reconnecting…",
        startingSolo: "Starting your match…",
        // Room screen
        settings: "Settings",
        language: "Question language",
        languages: { en: "English", bg: "Bulgarian" } as Record<string, string>,
        seatCount: "Seats",
        roundsLabel: "Rounds",
        placement: "Starting capital",
        seat: (n: number) => `Seat ${n}`,
        open: "Open",
        waitingForPlayer: "Waiting for a player…",
        bot: "Bot",
        author: "Host",
        you: "you",
        leave: "Leave",
        lock: "Lock & start",
        unlock: "Cancel",
        needAllSeats: "Fill every seat to start.",
        waitingForHost: "Waiting for the host to start…",
        startsIn: (seconds: number) => `Starting in ${seconds}…`,
        starting: "The match is starting!",
        removed: "The host gave your seat to a bot.",
        closed: "The room was closed.",
        errors: {
            room_not_found: "That room no longer exists.",
            wrong_password: "Wrong password.",
            room_full: "That room is full.",
            room_locked: "That room is locked.",
            already_in_room: "Leave your current room first.",
            not_in_room: "You're not in a room.",
            not_author: "Only the host can do that.",
            invalid: "That isn't possible right now.",
            not_your_turn: "It's not your turn.",
            no_questions: "There are no questions in that language yet.",
            internal: "Something went wrong on the server.",
        } as Record<string, string>,
    },

    lobby: {
        title: "New conquest",
        opponents: "Opponents",
        difficulty: "Bot difficulty",
        easy: "Easy",
        medium: "Medium",
        hard: "Hard",
        rounds: "Rounds",
        short: (n: number) => `Short · ${n}`,
        standard: (n: number) => `Standard · ${n}`,
        long: (n: number) => `Long · ${n}`,
        startingCapital: "Starting capital",
        choose: "Choose",
        random: "Random",
        start: "Start",
        back: "Back",
    },

    players: {
        you: "You",
        neutral: "Neutral",
        bots: {
            Asparuh: "Asparuh",
            Krum: "Krum",
            Simeon: "Simeon",
            Samuil: "Samuil",
        } as Record<string, string>,
    },

    status: {
        selectingYourCapital: "Selecting your capital…",
        selectingCapital: (name: string) => `${name} is selecting a capital…`,
        yourCapital: (region: string) => `Your capital: ${region}`,
        choseCapital: (name: string, region: string) =>
            `${name} chose ${region}`,
        chooseCapital: "Choose your capital",
        yourTurn: "Your turn — choose a region to attack",
        choosingTarget: (name: string) => `${name} is choosing a target…`,
        attacks: (who: Who, region: string) =>
            who.you
                ? `You attack ${region}!`
                : `${who.name} attacks ${region}!`,
        roundComplete: (round: number) => `Round ${round} complete`,
        finalRoundComplete: "Final round complete!",
        gameOver: "Game over",
        botTakesOver: (name: string) => `${name} left — a bot plays on`,
        secondsLeft: (n: number) => `${n}s`,
        siegeContinues: (battle: number) =>
            `Siege continues!\nBattle ${battle} for the capital`,
        tieBreaker: "Both correct!\nTie-breaker…",
        holds: (who: Who, region: string) =>
            who.you ? `You hold ${region}!` : `${who.name} holds ${region}!`,
        conquers: (who: Who, region: string) =>
            who.you
                ? `You conquer ${region}!`
                : `${who.name} conquers ${region}!`,
        capitalCaptured: (eliminated: Who) =>
            `Capital captured!\n${
                eliminated.you
                    ? "You are eliminated"
                    : `${eliminated.name} is eliminated`
            }`,
        wallBreached: "The wall is breached!",
        capitalHit: (shields: number) =>
            `Capital hit! ${plural(shields, "shield", "shields")} left`,
    },

    battle: {
        battleFor: (region: string) => `Battle for ${region}`,
        capitalSiege: (battle: number, shields: number) =>
            `Capital siege — battle ${battle}, ${plural(
                shields,
                "shield",
                "shields"
            )} left`,
        walled: "Walled",
        phaseMcq: "Phase 1 · Multiple choice",
        phaseNumeric:
            "Phase 2 · Tie-breaker: closest answer wins, then fastest",
        noAnswer: "No answer",
        correct: "Correct",
        wrong: "Wrong",
        yourAnswer: "Your answer",
        submit: "Submit",
        lockedIn: "Locked in",
        delete: "Delete",
        correctAnswer: (value: string) => `Correct answer: ${value}`,
        answerDetail: (answer: string, off: string, seconds: string) =>
            `Answer ${answer}  ·  off by ${off}  ·  ${seconds}s`,
        wins: "WINS",
        bothAnswering: (a: string, b: string) => `${a} and ${b} are answering…`,
        timeLeft: (seconds: number, opponentDone: boolean) =>
            `${seconds}s left  ·  Opponent ${
                opponentDone ? "has answered" : "is thinking…"
            }`,
    },

    hud: {
        round: (round: number, rounds: number) => `Round ${round}/${rounds}`,
        quit: "Quit",
        regions: "Regions",
        shields: "Capital shields",
        out: "out",
    },

    gameOver: {
        draw: "It's a draw!",
        victory: "Victory!",
        wins: (name: string) => `${name} wins`,
        nobody: "Nobody",
        eliminated: "eliminated",
        regions: (n: number) => plural(n, "region", "regions"),
        mainMenu: "Main menu",
        playAgain: "Play again",
        backToRoom: "Back to the room",
        pointsEarned: (n: string) => `+${n} points`,
    },

    controls: {
        mute: "Mute",
        unmute: "Unmute",
        fullscreen: "Fullscreen",
        exitFullscreen: "Exit fullscreen",
    },

    regions: {
        vidin: "Vidin",
        montana: "Montana",
        vratsa: "Vratsa",
        pleven: "Pleven",
        lovech: "Lovech",
        "veliko-tarnovo": "Veliko Tarnovo",
        ruse: "Ruse",
        silistra: "Silistra",
        razgrad: "Razgrad",
        targovishte: "Targovishte",
        shumen: "Shumen",
        dobrich: "Dobrich",
        varna: "Varna",
        burgas: "Burgas",
        sliven: "Sliven",
        yambol: "Yambol",
        "stara-zagora": "Stara Zagora",
        gabrovo: "Gabrovo",
        plovdiv: "Plovdiv",
        haskovo: "Haskovo",
        kardzhali: "Kardzhali",
        smolyan: "Smolyan",
        pazardzhik: "Pazardzhik",
        blagoevgrad: "Blagoevgrad",
        kyustendil: "Kyustendil",
        pernik: "Pernik",
        "sofia-city": "Sofia City",
        "sofia-province": "Sofia Province",
    } as Record<string, string>,
};

export type Messages = typeof en;
