import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        // Fetch all orders with relevant fields
        const result = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "ORDER#"
            },
            ExpressionAttributeNames: { "#s": "status" },
            ProjectionExpression: "id, #s, total, currency, paymentMethod, paymentStatus, items, createdAt, couponCode, couponDiscount"
        }));

        const orders = result.Items || [];
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const today = now.toISOString().slice(0, 10);

        // KPIs
        let totalRevenue = 0;
        let totalOrders = orders.length;
        let deliveredRevenue = 0;
        let todayRevenue = 0;
        let todayOrders = 0;
        let monthRevenue = 0;
        let monthOrders = 0;

        // By status
        const byStatus: Record<string, { count: number; revenue: number }> = {};

        // By payment method
        const byPayment: Record<string, { count: number; revenue: number }> = {};

        // By month (last 12 months)
        const byMonth: Record<string, { count: number; revenue: number }> = {};

        // Top products
        const productMap: Record<string, { title: string; quantity: number; revenue: number }> = {};

        // Coupon usage
        let couponOrders = 0;
        let couponDiscount = 0;

        for (const order of orders) {
            const amount = parseFloat(order.total) || 0;
            const status = order.status || "unknown";
            const payment = order.paymentMethod || "unknown";
            const date = (order.createdAt || "").slice(0, 10);
            const month = (order.createdAt || "").slice(0, 7);

            totalRevenue += amount;

            if (status === "delivered") deliveredRevenue += amount;

            if (date === today) { todayRevenue += amount; todayOrders++; }
            if (month === thisMonth) { monthRevenue += amount; monthOrders++; }

            // By status
            if (!byStatus[status]) byStatus[status] = { count: 0, revenue: 0 };
            byStatus[status].count++;
            byStatus[status].revenue += amount;

            // By payment
            if (!byPayment[payment]) byPayment[payment] = { count: 0, revenue: 0 };
            byPayment[payment].count++;
            byPayment[payment].revenue += amount;

            // By month
            if (month) {
                if (!byMonth[month]) byMonth[month] = { count: 0, revenue: 0 };
                byMonth[month].count++;
                byMonth[month].revenue += amount;
            }

            // Products
            if (Array.isArray(order.items)) {
                for (const item of order.items) {
                    const pid = item.productId || "unknown";
                    if (!productMap[pid]) productMap[pid] = { title: item.productTitle || pid, quantity: 0, revenue: 0 };
                    productMap[pid].quantity += item.quantity || 1;
                    productMap[pid].revenue += parseFloat(item.totalPrice) || 0;
                }
            }

            // Coupons
            if (order.couponCode) {
                couponOrders++;
                couponDiscount += parseFloat(order.couponDiscount) || 0;
            }
        }

        // Sort top products by revenue descending, take top 10
        const topProducts = Object.entries(productMap)
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);

        // Sort months descending, take last 12
        const revenueByMonth = Object.entries(byMonth)
            .map(([month, data]) => ({ month, ...data }))
            .sort((a, b) => b.month.localeCompare(a.month))
            .slice(0, 12);

        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const currency = orders[0]?.currency || "USD";

        return {
            statusCode: 200,
            body: JSON.stringify({
                kpi: {
                    totalRevenue: totalRevenue.toFixed(2),
                    totalOrders,
                    avgOrderValue: avgOrderValue.toFixed(2),
                    deliveredRevenue: deliveredRevenue.toFixed(2),
                    todayRevenue: todayRevenue.toFixed(2),
                    todayOrders,
                    monthRevenue: monthRevenue.toFixed(2),
                    monthOrders,
                    currency,
                },
                byStatus,
                byPayment,
                revenueByMonth,
                topProducts,
                coupons: { orders: couponOrders, discount: couponDiscount.toFixed(2) },
            }),
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
