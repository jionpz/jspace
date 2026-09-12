// CI negative control (temporary): core must never import application.
import { nowIso } from "../application/time.ts";
export const probe = nowIso;
