// Shared by all React pages and the standalone demo; one data source per session.
export { api } from "../frontend/api.js";
export { config } from "../frontend/config.js";
export const number = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "—";
export const casePath = (id) => `/exceptions/${encodeURIComponent(id)}`;
export const runPath = (id) => `/analysis/${encodeURIComponent(id)}`;
export const queuePath = (id) =>
  `/exceptions?${new URLSearchParams({ run_id: id })}`;
