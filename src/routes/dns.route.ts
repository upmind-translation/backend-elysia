import { Elysia, t } from "elysia";
import { DnsParseError, runDnsCheck } from "../services/dns.service";

// Route ini disesuaikan dengan Express `dnsController`
// Body bisa berupa string langsung atau object dengan properti `query`
export const dnsRoute = new Elysia().post(
  "/dns-check",
  async ({ body, set }) => {
    // Samakan perilaku dengan Express:
    // const payload = typeof req.body === "string" ? req.body : req.body?.query;
    const payload =
      typeof body === "string"
        ? body
        : body && typeof body === "object"
        ? // @ts-ignore - akan disesuaikan dengan tipe service nanti
          body.query
        : undefined;

    if (!payload) {
      set.status = 400;
      return {
        status: "error",
        message: "Body must contain 'query' property or be a string directly.",
      };
    }

    try {
      const result = await runDnsCheck(payload);
      const { domain, resolver, sections, output, cached } = result;

      set.status = 200;
      return {
        success: true,
        cached,
        data: {
          domain,
          resolver,
          sections,
          formatted: output,
        },
      };
    } catch (error: any) {
      if (error instanceof DnsParseError) {
        set.status = 400;
        return {
          status: "error",
          message: error.message,
        };
      }

      console.error("DNS check error:", error);
      set.status = 500;
      return {
        status: "error",
        message: "Failed to perform DNS check",
      };
    }
  },
  {
    // Dibuat longgar dulu supaya bisa menerima string langsung atau object.
    // Nanti bisa diperketat setelah `dns.service` fix.
    body: t.Any(),
  }
);
