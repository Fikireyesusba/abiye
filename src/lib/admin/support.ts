export const TICKET_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", waiting_customer: "Waiting for customer", resolved: "Resolved", closed: "Closed",
};
export const TICKET_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "outline" | "destructive"> = {
  open: "destructive", in_progress: "secondary", waiting_customer: "warning", resolved: "success", closed: "outline",
};
export const TICKET_TOPIC: Record<string, string> = {
  order: "Order", payment: "Payment", delivery: "Delivery / pickup", printing: "Printing", wallet: "Balance",
  account: "Account", product: "Product", app: "Website / app", other: "Other",
};
