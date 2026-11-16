import type { Messages, Who } from "./en";

/** Bulgarian UI text. Addresses the player informally (ти). */

/** "1 щит", "2 щита": masculine nouns take the count form after numbers. */
const shields = (n: number) => (n === 1 ? "1 щит" : `${n} щита`);
const remain = (n: number) => (n === 1 ? "остава" : "остават");

export const bg: Messages = {
    languageName: "Български",
    switchLanguage: "Превключи на английски · Switch to English",

    menu: {
        title: "Conquiztador",
        tagline: "Завладей България, въпрос по въпрос",
        newGame: "Нова игра",
    },

    lobby: {
        title: "Ново завоевание",
        opponents: "Противници",
        difficulty: "Трудност на ботовете",
        easy: "Лесна",
        medium: "Средна",
        hard: "Трудна",
        rounds: "Рундове",
        short: (n: number) => `Кратка · ${n}`,
        standard: (n: number) => `Средна · ${n}`,
        long: (n: number) => `Дълга · ${n}`,
        startingCapital: "Начална столица",
        choose: "Избор",
        random: "Случайна",
        start: "Старт",
        back: "Назад",
        loading: "Зареждане…",
        loadFailed: "Въпросите не се заредиха. Сървърът работи ли?",
        noQuestions: "Все още няма въпроси на български.",
    },

    players: {
        you: "Ти",
        neutral: "Неутрални",
        bots: {
            Asparuh: "Аспарух",
            Krum: "Крум",
            Simeon: "Симеон",
            Samuil: "Самуил",
        },
    },

    status: {
        selectingYourCapital: "Избира се твоята столица…",
        selectingCapital: (name: string) => `${name} избира столица…`,
        yourCapital: (region: string) => `Твоята столица: ${region}`,
        choseCapital: (name: string, region: string) =>
            `${name} избра ${region}`,
        chooseCapital: "Избери столица",
        yourTurn: "Твой ред — избери област за нападение",
        choosingTarget: (name: string) => `${name} избира цел…`,
        attacks: (who: Who, region: string) =>
            who.you ? `Нападаш ${region}!` : `${who.name} напада ${region}!`,
        roundComplete: (round: number) => `Рунд ${round} приключи`,
        finalRoundComplete: "Последният рунд приключи!",
        gameOver: "Край на играта",
        siegeContinues: (battle: number) =>
            `Обсадата продължава!\nБитка ${battle} за столицата`,
        tieBreaker: "И двата отговора са верни!\nДопълнителен въпрос…",
        holds: (who: Who, region: string) =>
            who.you ? `Удържаш ${region}!` : `${who.name} удържа ${region}!`,
        conquers: (who: Who, region: string) =>
            who.you
                ? `Превземаш ${region}!`
                : `${who.name} превзема ${region}!`,
        capitalCaptured: (eliminated: Who) =>
            `Столицата е превзета!\n${
                eliminated.you
                    ? "Отпадаш от играта"
                    : `${eliminated.name} отпада от играта`
            }`,
        wallBreached: "Стената е пробита!",
        capitalHit: (n: number) =>
            `Удар по столицата! ${remain(n)[0].toUpperCase()}${remain(n).slice(
                1
            )} ${shields(n)}`,
    },

    battle: {
        battleFor: (region: string) => `Битка за ${region}`,
        capitalSiege: (battle: number, n: number) =>
            `Обсада на столица — битка ${battle}, ${remain(n)} ${shields(n)}`,
        walled: "Укрепена",
        phaseMcq: "Фаза 1 · Избор на отговор",
        phaseNumeric:
            "Фаза 2 · Допълнителен въпрос: печели най-близкият отговор, после най-бързият",
        noAnswer: "Без отговор",
        correct: "Вярно",
        wrong: "Грешно",
        yourAnswer: "Твоят отговор",
        submit: "Изпрати",
        lockedIn: "Изпратено",
        delete: "Изтрий",
        correctAnswer: (value: string) => `Верен отговор: ${value}`,
        answerDetail: (answer: string, off: string, seconds: string) =>
            `Отговор ${answer}  ·  разлика ${off}  ·  ${seconds} с`,
        wins: "ПЕЧЕЛИ",
        bothAnswering: (a: string, b: string) => `${a} и ${b} отговарят…`,
        timeLeft: (seconds: number, opponentDone: boolean) =>
            `${seconds} с  ·  Противникът ${
                opponentDone ? "отговори" : "мисли…"
            }`,
    },

    hud: {
        round: (round: number, rounds: number) => `Рунд ${round}/${rounds}`,
        quit: "Изход",
        regions: "Области",
        shields: "Щитове на столицата",
        out: "отпадна",
    },

    gameOver: {
        draw: "Равенство!",
        victory: "Победа!",
        wins: (name: string) => `${name} печели`,
        nobody: "Никой",
        eliminated: "отпадна",
        regions: (n: number) => (n === 1 ? "1 област" : `${n} области`),
        mainMenu: "Главно меню",
        playAgain: "Нова игра",
    },

    controls: {
        mute: "Изключи звука",
        unmute: "Включи звука",
        fullscreen: "Цял екран",
        exitFullscreen: "Изход от цял екран",
    },

    regions: {
        vidin: "Видин",
        montana: "Монтана",
        vratsa: "Враца",
        pleven: "Плевен",
        lovech: "Ловеч",
        "veliko-tarnovo": "Велико Търново",
        ruse: "Русе",
        silistra: "Силистра",
        razgrad: "Разград",
        targovishte: "Търговище",
        shumen: "Шумен",
        dobrich: "Добрич",
        varna: "Варна",
        burgas: "Бургас",
        sliven: "Сливен",
        yambol: "Ямбол",
        "stara-zagora": "Стара Загора",
        gabrovo: "Габрово",
        plovdiv: "Пловдив",
        haskovo: "Хасково",
        kardzhali: "Кърджали",
        smolyan: "Смолян",
        pazardzhik: "Пазарджик",
        blagoevgrad: "Благоевград",
        kyustendil: "Кюстендил",
        pernik: "Перник",
        "sofia-city": "София-град",
        "sofia-province": "Софийска област",
    },
};
