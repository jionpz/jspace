// CI negative control (temporary): core must never import application.
import { localDate } from "../application/time.ts";
export const probe = localDate;
