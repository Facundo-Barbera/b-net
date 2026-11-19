/**
 * Canonical Board read model (GET /api/v1/board) for the UI's fixture mode and tests. All data is FAKE:
 * bot names, PR numbers and thread ids are made up, and the repo is the public one.
 */
import type { BoardWork } from "../contracts/board.ts";
import { FIXTURE_NOW } from "./snapshot.ts";

const now = Date.parse(FIXTURE_NOW);
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const ahead = (min: number) => new Date(now + min * 60_000).toISOString();

export const boardFixture: BoardWork = {
  generatedAt: FIXTURE_NOW,
  state: "ok",
  error: null,
  projects: [
    {
      project: "b-net",
      tasks: [
        {
          id: "41",
          channel: "b-net/work",
          title: "¿Fusionar el PR de la UI antes del deploy del viernes?",
          state: "blocked",
          claimedBy: null,
          until: null,
          note: "Espera tu aprobación",
          pr: "Facundo-Barbera/b-net#5",
          stateLabel: "review",
          replies: 3,
          updatedAt: ago(18),
        },
        {
          id: "37",
          channel: "b-net/work",
          title: "Montar Board dentro del hub",
          state: "claimed",
          claimedBy: "orquestador",
          until: ahead(9),
          note: null,
          pr: "Facundo-Barbera/b-net#5",
          stateLabel: "doing",
          replies: 6,
          updatedAt: ago(4),
        },
        {
          id: "44",
          channel: "b-net/work",
          title: "Capturas de la vista Proyectos en la mini",
          state: "ready",
          claimedBy: null,
          until: null,
          note: null,
          pr: null,
          stateLabel: null,
          replies: 0,
          updatedAt: ago(30),
        },
        {
          id: "45",
          channel: "b-net/work",
          title: "Probar el webhook con reintentos",
          state: "waiting",
          claimedBy: null,
          until: null,
          note: null,
          pr: null,
          stateLabel: null,
          replies: 0,
          updatedAt: ago(30),
        },
        {
          id: "29",
          channel: "b-net/work",
          title: "Métricas propias en el agente",
          state: "completed",
          claimedBy: null,
          until: null,
          note: "PR #4 fusionado",
          pr: "Facundo-Barbera/b-net#4",
          stateLabel: "done",
          replies: 9,
          updatedAt: ago(60 * 20),
        },
      ],
      updates: [
        { id: "52", channel: "b-net/work", author: "orquestador", text: "Tests del hub en verde en la mini; faltan las capturas.", at: ago(4) },
        { id: "50", channel: "b-net/prs", author: "orquestador", text: "PR #5 actualizado con el montaje de Board.", at: ago(25) },
      ],
      prs: [
        { ref: "Facundo-Barbera/b-net#5", url: "https://github.com/Facundo-Barbera/b-net/pull/5", title: "web: rehacer la UI como centro de trabajo", state: "open", at: ago(25) },
        { ref: "Facundo-Barbera/b-net#4", url: "https://github.com/Facundo-Barbera/b-net/pull/4", title: "Métricas propias", state: "merged", at: ago(60 * 20) },
      ],
      events: [
        {
          id: "48",
          at: ago(18),
          event: { v: 1, kind: "question", project: "b-net", thread: "th_01", summary: "¿Fusiono el PR #5 o espero a las capturas?", link: "https://github.com/Facundo-Barbera/b-net/pull/5" },
        },
        {
          id: "33",
          at: ago(95),
          event: { v: 1, kind: "thread_done", project: "b-net", thread: "th_02", summary: "Contrato de entregables listo.", link: null },
        },
      ],
    },
    {
      project: "bixku-bot",
      tasks: [
        {
          id: "39",
          channel: "bixku-bot/work",
          title: "Comandos nuevos del bot",
          state: "failed",
          claimedBy: null,
          until: null,
          note: "El token de prueba venció",
          pr: null,
          stateLabel: null,
          replies: 2,
          updatedAt: ago(70),
        },
      ],
      updates: [],
      prs: [],
      events: [
        {
          id: "40",
          at: ago(70),
          event: { v: 1, kind: "blocked", project: "bixku-bot", thread: "th_06", summary: "Sin token de prueba para Telegram.", link: null },
        },
      ],
    },
  ],
};
