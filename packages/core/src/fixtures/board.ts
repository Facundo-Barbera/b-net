/**
 * Canonical Board read model (GET /api/v1/board/projects) for the UI's fixture mode and tests. All data is
 * FAKE: bot names, PR numbers and thread ids are made up; the repo is the public one.
 */
import type { BoardProjectsResponse } from "../contracts/board.ts";
import { FIXTURE_NOW } from "./snapshot.ts";

const now = Date.parse(FIXTURE_NOW);
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const ahead = (min: number) => new Date(now + min * 60_000).toISOString();

export const boardFixture: BoardProjectsResponse = {
  generatedAt: FIXTURE_NOW,
  projects: [
    {
      slug: "b-net",
      name: "b-net",
      bot: "fstack-vps",
      tasks: [
        { id: "41", title: "¿Fusionar el PR de la UI antes del deploy del viernes?", state: "bloqueado", pr: "Facundo-Barbera/b-net#5", thread: "th_01", updatedAt: ago(18) },
        { id: "37", title: "Montar Board dentro del hub", state: "en_curso", claimedBy: "orquestador", leaseUntil: ahead(9), pr: "Facundo-Barbera/b-net#5", updatedAt: ago(4) },
        { id: "44", title: "Capturas de la vista Proyectos en la mini", state: "en_espera", updatedAt: ago(30) },
        { id: "29", title: "Métricas propias en el agente", state: "listo", pr: "Facundo-Barbera/b-net#4", updatedAt: ago(60 * 20) },
      ],
      updates: [
        { id: "52", text: "Tests del hub en verde en la mini; faltan las capturas.", author: "orquestador", at: ago(4) },
        { id: "50", text: "PR #5 actualizado con el montaje de Board.", author: "orquestador", at: ago(25), link: "https://github.com/Facundo-Barbera/b-net/pull/5" },
      ],
      prs: [
        { ref: "Facundo-Barbera/b-net#5", title: "web: rehacer la UI como centro de trabajo", url: "https://github.com/Facundo-Barbera/b-net/pull/5", state: "abierto", updatedAt: ago(25) },
        { ref: "Facundo-Barbera/b-net#4", title: "Métricas propias", url: "https://github.com/Facundo-Barbera/b-net/pull/4", state: "fusionado", updatedAt: ago(60 * 20) },
      ],
      events: [
        { schema: "bnet.event", version: 1, kind: "question", project: "b-net", bot: "fstack-vps", thread: "th_01", summary: "¿Fusiono el PR #5 o espero a las capturas?", link: "https://github.com/Facundo-Barbera/b-net/pull/5", at: ago(18) },
        { schema: "bnet.event", version: 1, kind: "thread_done", project: "b-net", bot: "fstack-vps", thread: "th_02", summary: "Contrato de entregables listo.", at: ago(95) },
      ],
      summaries: [{ id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1", title: "Resumen: pase de UI con fstack", at: ago(12) }],
    },
    {
      slug: "bixku-bot",
      name: "Bot de Telegram",
      bot: "telegram-bot",
      tasks: [{ id: "39", title: "Comandos nuevos del bot", state: "bloqueado", thread: "th_06", updatedAt: ago(70) }],
      updates: [],
      prs: [],
      events: [{ schema: "bnet.event", version: 1, kind: "blocked", project: "bixku-bot", bot: "telegram-bot", thread: "th_06", summary: "Sin token de prueba para Telegram.", at: ago(70) }],
      summaries: [],
    },
  ],
};
