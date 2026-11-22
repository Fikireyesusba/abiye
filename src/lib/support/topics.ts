/** Support ticket topics (must match the check on public.support_tickets.category). */
export const TICKET_TOPICS = ["order", "payment", "delivery", "printing", "wallet", "account", "product", "app", "other"] as const;
export type TicketTopic = (typeof TICKET_TOPICS)[number];
/** Topics that need one of the customer's order numbers; printing may give one. */
export const ORDER_REQUIRED: readonly TicketTopic[] = ["order", "payment", "delivery"];
export const ORDER_OPTIONAL: readonly TicketTopic[] = ["printing", "wallet", "product"];
export const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
