import { MapGraph, Region } from "../types";

/** The 28 provinces (oblasts) of Bulgaria with their land borders. */
const regions: Region[] = [
    { id: "vidin", name: "Vidin", neighbors: ["montana"] },
    {
        id: "montana",
        name: "Montana",
        neighbors: ["vidin", "vratsa", "sofia-province"],
    },
    {
        id: "vratsa",
        name: "Vratsa",
        neighbors: ["montana", "sofia-province", "lovech", "pleven"],
    },
    {
        id: "pleven",
        name: "Pleven",
        neighbors: ["vratsa", "lovech", "veliko-tarnovo"],
    },
    {
        id: "lovech",
        name: "Lovech",
        neighbors: [
            "pleven",
            "vratsa",
            "sofia-province",
            "plovdiv",
            "gabrovo",
            "veliko-tarnovo",
        ],
    },
    {
        id: "veliko-tarnovo",
        name: "Veliko Tarnovo",
        neighbors: [
            "pleven",
            "lovech",
            "gabrovo",
            "stara-zagora",
            "sliven",
            "targovishte",
            "ruse",
        ],
    },
    {
        id: "ruse",
        name: "Ruse",
        neighbors: ["veliko-tarnovo", "targovishte", "razgrad", "silistra"],
    },
    {
        id: "silistra",
        name: "Silistra",
        neighbors: ["ruse", "razgrad", "shumen", "dobrich"],
    },
    {
        id: "razgrad",
        name: "Razgrad",
        neighbors: ["ruse", "silistra", "shumen", "targovishte"],
    },
    {
        id: "targovishte",
        name: "Targovishte",
        neighbors: ["ruse", "razgrad", "shumen", "sliven", "veliko-tarnovo"],
    },
    {
        id: "shumen",
        name: "Shumen",
        neighbors: [
            "razgrad",
            "silistra",
            "dobrich",
            "varna",
            "burgas",
            "sliven",
            "targovishte",
        ],
    },
    {
        id: "dobrich",
        name: "Dobrich",
        neighbors: ["silistra", "shumen", "varna"],
    },
    { id: "varna", name: "Varna", neighbors: ["dobrich", "shumen", "burgas"] },
    {
        id: "burgas",
        name: "Burgas",
        neighbors: ["varna", "shumen", "sliven", "yambol"],
    },
    {
        id: "sliven",
        name: "Sliven",
        neighbors: [
            "shumen",
            "targovishte",
            "veliko-tarnovo",
            "stara-zagora",
            "yambol",
            "burgas",
        ],
    },
    {
        id: "yambol",
        name: "Yambol",
        neighbors: ["sliven", "burgas", "stara-zagora", "haskovo"],
    },
    {
        id: "stara-zagora",
        name: "Stara Zagora",
        neighbors: [
            "veliko-tarnovo",
            "gabrovo",
            "plovdiv",
            "haskovo",
            "yambol",
            "sliven",
        ],
    },
    {
        id: "gabrovo",
        name: "Gabrovo",
        neighbors: ["lovech", "veliko-tarnovo", "stara-zagora", "plovdiv"],
    },
    {
        id: "plovdiv",
        name: "Plovdiv",
        neighbors: [
            "lovech",
            "gabrovo",
            "stara-zagora",
            "haskovo",
            "kardzhali",
            "smolyan",
            "pazardzhik",
            "sofia-province",
        ],
    },
    {
        id: "haskovo",
        name: "Haskovo",
        neighbors: ["plovdiv", "stara-zagora", "yambol", "kardzhali"],
    },
    {
        id: "kardzhali",
        name: "Kardzhali",
        neighbors: ["haskovo", "plovdiv", "smolyan"],
    },
    {
        id: "smolyan",
        name: "Smolyan",
        neighbors: ["kardzhali", "plovdiv", "pazardzhik", "blagoevgrad"],
    },
    {
        id: "pazardzhik",
        name: "Pazardzhik",
        neighbors: ["sofia-province", "plovdiv", "smolyan", "blagoevgrad"],
    },
    {
        id: "blagoevgrad",
        name: "Blagoevgrad",
        neighbors: ["kyustendil", "sofia-province", "pazardzhik", "smolyan"],
    },
    {
        id: "kyustendil",
        name: "Kyustendil",
        neighbors: ["pernik", "sofia-province", "blagoevgrad"],
    },
    {
        id: "pernik",
        name: "Pernik",
        neighbors: ["sofia-province", "sofia-city", "kyustendil"],
    },
    {
        id: "sofia-city",
        name: "Sofia City",
        neighbors: ["sofia-province", "pernik"],
    },
    {
        id: "sofia-province",
        name: "Sofia Province",
        neighbors: [
            "montana",
            "vratsa",
            "lovech",
            "plovdiv",
            "pazardzhik",
            "blagoevgrad",
            "kyustendil",
            "pernik",
            "sofia-city",
        ],
    },
];

export const BULGARIA: MapGraph = {
    id: "bulgaria",
    regions: Object.fromEntries(regions.map((r) => [r.id, r])),
};
