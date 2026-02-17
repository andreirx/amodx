export interface OrderEmailTemplate {
    subject: string;
    body: string;
    sendToCustomer: boolean;
    sendToAdmin: boolean;
    sendToProcessing: boolean;
}

export const STATUS_LABELS: Record<string, string> = {
    placed: "Placed",
    confirmed: "Confirmed",
    prepared: "Prepared",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    annulled: "Annulled",
};

export function getDefaultTemplates(): Record<string, OrderEmailTemplate> {
    return {
        placed: {
            subject: "Order {{orderNumber}} – Thank You!",
            body: "Thank you for your order {{orderNumber}}!",
            sendToCustomer: true,
            sendToAdmin: true,
            sendToProcessing: true,
        },
        confirmed: {
            subject: "Order {{orderNumber}} Confirmed",
            body: "Your order {{orderNumber}} has been confirmed.",
            sendToCustomer: true,
            sendToAdmin: false,
            sendToProcessing: false,
        },
        prepared: {
            subject: "Order {{orderNumber}} Ready for Shipping",
            body: "Your order {{orderNumber}} is ready for shipping.",
            sendToCustomer: true,
            sendToAdmin: false,
            sendToProcessing: false,
        },
        shipped: {
            subject: "Order {{orderNumber}} Shipped",
            body: "Your order {{orderNumber}} has been shipped. Tracking: {{trackingNumber}}",
            sendToCustomer: true,
            sendToAdmin: false,
            sendToProcessing: false,
        },
        delivered: {
            subject: "Order {{orderNumber}} Delivered",
            body: "Your order {{orderNumber}} has been delivered.",
            sendToCustomer: true,
            sendToAdmin: false,
            sendToProcessing: false,
        },
        cancelled: {
            subject: "Order {{orderNumber}} Cancelled",
            body: "Your order {{orderNumber}} has been cancelled.",
            sendToCustomer: true,
            sendToAdmin: false,
            sendToProcessing: false,
        },
        annulled: {
            subject: "Order {{orderNumber}} Annulled",
            body: "Your order {{orderNumber}} has been annulled. {{note}}",
            sendToCustomer: true,
            sendToAdmin: false,
            sendToProcessing: false,
        },
    };
}

/**
 * Replace `{{variableName}}` placeholders in a template string with values
 * from the provided vars map. Unmatched placeholders are left as-is.
 */
export function renderTemplate(
    template: string,
    vars: Record<string, string>,
): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        return key in vars ? vars[key] : match;
    });
}

/**
 * Convenience: render both subject and body of an OrderEmailTemplate.
 */
export function renderEmailTemplate(
    tpl: OrderEmailTemplate,
    vars: Record<string, string>,
): { subject: string; body: string } {
    return {
        subject: renderTemplate(tpl.subject, vars),
        body: renderTemplate(tpl.body, vars),
    };
}
