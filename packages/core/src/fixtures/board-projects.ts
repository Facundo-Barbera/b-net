/**
 * Example GET /api/v1/board/projects (BoardProjectsResponse) for the UI's fixture mode, its dev fallback and
 * tests. All data is FAKE: bots, thread ids and PR numbers are made up; the repo is the public one.
 * Slugs and summary ids match projectsFixture, so "abrir resumen" lands on a deliverable that exists.
 * The three projects cover the states the UI must show: with data (fhub), blocked (bixku-bot), empty (homelab-ops).
 */
import type { BoardProjectsResponse } from "../contracts/board.ts";
import { FIXTURE_NOW } from "./snapshot.ts";

const now = Date.parse(FIXTURE_NOW);
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const ahead = (min: number) => new Date(now + min * 60_000).toISOString();

export const boardProjectsFixture: BoardProjectsResponse = {
  generatedAt: FIXTURE_NOW,
  projects: [
    {
      slug: "fhub",
      name: "fhub",
      bot: "fstack-vps",
      tasks: [
        {
          id: "41",
          title: "¿Fusionar el PR de la UI antes del deploy del viernes?",
          state: "bloqueado",
          pr: "Facundo-Barbera/fhub#5",
          thread: "th_01",
          updatedAt: ago(18),
        },
        {
          id: "37",
          title: "Montar Board dentro del hub",
          state: "en_curso",
          claimedBy: "orquestador",
          leaseUntil: ahead(9),
          thread: "th_02",
          updatedAt: ago(4),
        },
        { id: "44", title: "Capturas de la vista Proyectos en la mini", state: "en_espera", updatedAt: ago(30) },
        { id: "45", title: "Probar el webhook con reintentos", state: "en_espera", updatedAt: ago(32) },
        { id: "29", title: "Métricas propias en el agente", state: "listo", pr: "Facundo-Barbera/fhub#4", updatedAt: ago(60 * 20) },
      ],
      updates: [
        { id: "52", author: "orquestador", text: "Tests del hub en verde en la mini; faltan las capturas.", at: ago(4) },
        {
          id: "50",
          author: "fstack-vps",
          text: "PR #5 actualizado con el rediseño de Trabajo y Proyectos.",
          at: ago(25),
          link: "https://github.com/Facundo-Barbera/fhub/pull/5",
        },
      ],
      prs: [
        {
          ref: "Facundo-Barbera/fhub#5",
          title: "web: rehacer la UI como centro de trabajo",
          url: "https://github.com/Facundo-Barbera/fhub/pull/5",
          state: "abierto",
          updatedAt: ago(25),
        },
        {
          ref: "Facundo-Barbera/fhub#4",
          title: "Métricas propias",
          url: "https://github.com/Facundo-Barbera/fhub/pull/4",
          state: "fusionado",
          updatedAt: ago(60 * 20),
        },
        {
          ref: "Facundo-Barbera/fhub#3",
          title: "Prueba descartada del proxy",
          url: "https://github.com/Facundo-Barbera/fhub/pull/3",
          state: "cerrado",
          updatedAt: ago(60 * 30),
        },
      ],
      events: [
        {
          schema: "bnet.event",
          version: 1,
          kind: "question",
          project: "fhub",
          bot: "fstack-vps",
          thread: "th_01",
          summary: "¿Fusiono el PR #5 o espero a las capturas?",
          link: "https://github.com/Facundo-Barbera/fhub/pull/5",
          at: ago(18),
        },
        {
          schema: "bnet.event",
          version: 1,
          kind: "thread_done",
          project: "fhub",
          bot: "fstack-vps",
          thread: "th_03",
          summary: "Contrato de entregables listo.",
          at: ago(95),
        },
      ],
      summaries: [
        { id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1", title: "Resumen: pase de UI con fstack", at: ago(40) },
        { id: "1c8d2e3f-4051-4b62-8c73-8d94ea5fb602", title: "Informe: API de proyectos y entregables", at: ago(60 * 5) },
      ],
    },
    {
      slug: "bixku-bot",
      name: "Bot de Telegram",
      bot: "bixku-bot",
      tasks: [
        { id: "39", title: "Comandos nuevos del bot", state: "bloqueado", thread: "th_06", updatedAt: ago(70) },
        { id: "40", title: "Desplegar el bot en el homelab", state: "en_espera", updatedAt: ago(60 * 3) },
      ],
      updates: [],
      prs: [],
      events: [
        {
          schema: "bnet.event",
          version: 1,
          kind: "blocked",
          project: "bixku-bot",
          bot: "bixku-bot",
          thread: "th_06",
          summary: "Sin token de prueba para Telegram.",
          at: ago(70),
        },
      ],
      summaries: [{ id: "3e0f4051-6273-4d84-8e95-afb6c7d18824", title: "Diseño de comandos del bot", at: ago(60 * 24 * 10) }],
    },
    { slug: "homelab-ops", name: "Homelab ops", tasks: [], updates: [], prs: [], events: [], summaries: [] },
  ],
};
