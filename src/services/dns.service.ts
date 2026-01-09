import { Resolver } from "dns/promises";

const DEFAULT_RESOLVER = "1.1.1.1";
const DEFAULT_ORDER = [
  "a",
  "mail",
  "ns",
  "mx",
  "txt",
  "dkim",
  "dmarc",
  "www",
] as const;

const RECORD_ALIASES: Record<string, string> = {
  a: "a",
  mx: "mx",
  ns: "ns",
  txt: "txt",
  spf: "txt",
  www: "www",
  "www-a": "www",
  mail: "mail",
  "mail-a": "mail",
  dmarc: "dmarc",
  dkim: "dkim",
};

const CACHE_TTL_MS = 60 * 1000;

type CacheKeyParams = {
  domain: string;
  resolver: string;
  recordOrder: string[] | null;
};

type SectionBase = {
  key: string;
  title: string;
  lines: string[];
};

type Section =
  | SectionBase & {
      records: any;
      host?: string;
    };

export class DnsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnsParseError";
  }
}

const dnsCache = new Map<
  string,
  {
    value: {
      domain: string;
      resolver: string;
      sections: Section[];
      output: string;
    };
    expiresAt: number;
  }
>();

const makeCacheKey = ({
  domain,
  resolver,
  recordOrder,
}: CacheKeyParams): string => {
  const orderKey =
    recordOrder && recordOrder.length ? recordOrder.join("|") : "__default__";
  return `${domain}|${resolver}|${orderKey}`;
};

const getCachedResult = (key: string) => {
  const entry = dnsCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    dnsCache.delete(key);
    return null;
  }

  return entry.value;
};

const setCachedResult = (
  key: string,
  value: {
    domain: string;
    resolver: string;
    sections: Section[];
    output: string;
  }
) => {
  dnsCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const SOFT_ERROR_CODES = new Set([
  "ENODATA",
  "ESERVFAIL",
  "ENOTFOUND",
  "NXDOMAIN",
  "EREFUSED",
  "ETIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "REFUSED",
  "SERVFAIL",
  "NOTFOUND",
  "FORMERR",
  "NOANSWER",
  "NOTIMP",
  "ERR_DNS_NO_DATA",
  "ERR_DNS_FORMERR",
  "ERR_DNS_BADNAME",
  "ERR_DNS_BAD_NAME",
  "ERR_DNS_QUERY_REFUSED",
  "ERR_DNS_NXDOMAIN",
  "ERR_DNS_SERVER_FAILED",
  "ERR_DNS_TIMEOUT",
  "ERR_DNS_NOTFOUND",
  "ERR_DNS_REFUSED",
  "DNSQueryRefusedError",
  "DNSQueryNoAnswerError",
]);

const isNoAnswerError = (error: any): boolean => {
  if (!error) return false;
  if (typeof error.code === "string" && SOFT_ERROR_CODES.has(error.code)) {
    return true;
  }
  if (typeof error.errno === "string" && SOFT_ERROR_CODES.has(error.errno)) {
    return true;
  }
  if (typeof error.name === "string" && SOFT_ERROR_CODES.has(error.name)) {
    return true;
  }
  return false;
};

type ParsedInput = {
  domain: string;
  resolver: string | null;
  recordOrder: string[] | null;
};

const parseInput = (rawInput: string): ParsedInput => {
  if (!rawInput || typeof rawInput !== "string") {
    throw new DnsParseError("Input harus berupa string.");
  }

  const input = rawInput.trim();
  if (!input) {
    throw new DnsParseError("Input tidak boleh kosong.");
  }

  let withoutRecords = input;
  let recordSpec: string | null = null;

  const recordMatch = input.match(/--([^\s]+)/);
  if (recordMatch) {
    recordSpec = recordMatch[1];
    withoutRecords = withoutRecords.replace(recordMatch[0], "").trim();
  }

  let resolver: string | null = null;
  let domainPart = withoutRecords;
  const resolverMatch = withoutRecords.match(/@([^\s]+)/);
  if (resolverMatch) {
    resolver = resolverMatch[1];
    domainPart = domainPart.replace(resolverMatch[0], "").trim();
  }

  const domain = domainPart.split(/\s+/)[0];
  if (!domain) {
    throw new DnsParseError("Domain tidak ditemukan pada input.");
  }

  let recordOrder: string[] | null = null;
  if (recordSpec) {
    recordOrder = recordSpec
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .map((item) => RECORD_ALIASES[item] || null)
      .filter((item): item is string => Boolean(item));

    if (recordOrder.length === 0) {
      throw new DnsParseError("Daftar record tidak valid.");
    }

    // Remove duplicates preserving order
    recordOrder = recordOrder.filter(
      (item, index) => recordOrder && recordOrder.indexOf(item) === index
    );
  }

  return {
    domain: domain.toLowerCase(),
    resolver: resolver ? resolver.toLowerCase() : null,
    recordOrder,
  };
};

const createResolver = (preferredResolver: string | null) => {
  const resolver = new Resolver();
  if (preferredResolver) {
    resolver.setServers([preferredResolver]);
  } else {
    resolver.setServers([DEFAULT_RESOLVER]);
  }
  return resolver;
};

type EnrichedAddress = {
  ip: string;
  hostname: string | null;
};

const resolveHostAddresses = async (
  resolver: Resolver,
  host: string
): Promise<EnrichedAddress[]> => {
  try {
    const addresses = await resolver.resolve4(host);
    const enriched = await Promise.all(
      addresses.map(async (ip) => {
        try {
          const reverseNames = await resolver.reverse(ip);
          const reverseName = reverseNames && reverseNames[0];
          return { ip, hostname: reverseName || null };
        } catch (reverseError) {
          if (isNoAnswerError(reverseError)) {
            return { ip, hostname: null };
          }
          throw reverseError;
        }
      })
    );
    return enriched;
  } catch (error) {
    if (isNoAnswerError(error)) {
      return [];
    }
    throw error;
  }
};

const fetchARecord = async (resolver: Resolver, domain: string) =>
  resolveHostAddresses(resolver, domain);

type MxRecordEnriched = {
  priority: number;
  exchange: string;
  addresses: EnrichedAddress[];
};

const fetchMxRecords = async (
  resolver: Resolver,
  domain: string
): Promise<MxRecordEnriched[]> => {
  try {
    const records = await resolver.resolveMx(domain);
    const sorted = records.sort((a, b) => a.priority - b.priority);

    const enriched: MxRecordEnriched[] = [];
    for (const record of sorted) {
      const addresses = await resolveHostAddresses(resolver, record.exchange);
      enriched.push({
        priority: record.priority,
        exchange: record.exchange,
        addresses,
      });
    }

    return enriched;
  } catch (error) {
    if (isNoAnswerError(error)) {
      return [];
    }
    throw error;
  }
};

type NsRecordEnriched = {
  ns: string;
  addresses: EnrichedAddress[];
};

const fetchNsRecords = async (
  resolver: Resolver,
  domain: string
): Promise<NsRecordEnriched[]> => {
  try {
    const nameServers = await resolver.resolveNs(domain);
    const enriched: NsRecordEnriched[] = [];

    for (const ns of nameServers) {
      const addresses = await resolveHostAddresses(resolver, ns);
      enriched.push({ ns, addresses });
    }

    return enriched;
  } catch (error) {
    if (isNoAnswerError(error)) {
      return [];
    }
    throw error;
  }
};

const fetchTxtRecords = async (
  resolver: Resolver,
  host: string
): Promise<string[]> => {
  try {
    const records = await resolver.resolveTxt(host);
    return records.map((entry) => entry.join(""));
  } catch (error) {
    if (isNoAnswerError(error)) {
      return [];
    }
    throw error;
  }
};

const formatAddressLine = (address: EnrichedAddress): string => {
  if (!address.hostname) {
    return address.ip;
  }
  return `${address.ip} (${address.hostname})`;
};

type BuildSectionsParams = {
  domain: string;
  resolverClient: Resolver;
  recordOrder: string[] | null;
};

const buildSections = async ({
  domain,
  resolverClient,
  recordOrder,
}: BuildSectionsParams): Promise<Section[]> => {
  const order = (recordOrder || DEFAULT_ORDER) as string[];
  const sections: Section[] = [];

  for (const recordKey of order) {
    switch (recordKey) {
      case "a": {
        const records = await fetchARecord(resolverClient, domain);
        sections.push({
          key: "a",
          title: "A Record",
          records,
          lines: records.length
            ? records.map(formatAddressLine)
            : ["Tidak ada data"],
        });
        break;
      }
      case "mail": {
        const host = `mail.${domain}`;
        const records = await fetchARecord(resolverClient, host);
        sections.push({
          key: "mail",
          title: "Mail A Record",
          host,
          records,
          lines: records.length
            ? records.map(formatAddressLine)
            : [`Tidak ditemukan A record untuk ${host}`],
        });
        break;
      }
      case "www": {
        const host = `www.${domain}`;
        const records = await fetchARecord(resolverClient, host);
        sections.push({
          key: "www",
          title: "WWW A Record",
          host,
          records,
          lines: records.length
            ? records.map(formatAddressLine)
            : [`Tidak ditemukan A record untuk ${host}`],
        });
        break;
      }
      case "ns": {
        const records = await fetchNsRecords(resolverClient, domain);
        sections.push({
          key: "ns",
          title: "Name Server",
          records: records.map((entry) => ({
            ns: entry.ns,
            addresses: entry.addresses,
          })),
          lines: records.length
            ? records.map((entry) => {
                const firstAddress = entry.addresses[0];
                if (!firstAddress) {
                  return entry.ns;
                }
                if (firstAddress.ip) {
                  return `${entry.ns} (${firstAddress.ip})`;
                }
                if (firstAddress.hostname) {
                  return `${entry.ns} (${firstAddress.hostname})`;
                }
                return entry.ns;
              })
            : ["Tidak ditemukan NS record"],
        });
        break;
      }
      case "mx": {
        const records = await fetchMxRecords(resolverClient, domain);
        sections.push({
          key: "mx",
          title: "MX Record",
          records,
          lines: records.length
            ? records.map((entry) => {
                const ips = entry.addresses
                  .map((address) => address.ip)
                  .join(", ");
                return ips ? `${entry.exchange} (${ips})` : entry.exchange;
              })
            : ["Tidak ditemukan MX record"],
        });
        break;
      }
      case "txt": {
        const records = await fetchTxtRecords(resolverClient, domain);
        sections.push({
          key: "txt",
          title: "TXT / SPF",
          records,
          lines: records.length ? records : ["Tidak ditemukan TXT record"],
        });
        break;
      }
      case "dmarc": {
        const host = `_dmarc.${domain}`;
        const records = await fetchTxtRecords(resolverClient, host);
        sections.push({
          key: "dmarc",
          title: `DMARC (${host})`,
          host,
          records,
          lines: records.length ? records : ["Tidak ditemukan DMARC record"],
        });
        break;
      }
      case "dkim": {
        const host = `default._domainkey.${domain}`;
        const records = await fetchTxtRecords(resolverClient, host);
        sections.push({
          key: "dkim",
          title: `DKIM (${host})`,
          host,
          records,
          lines: records.length ? records : ["Tidak ditemukan DKIM record"],
        });
        break;
      }
      default:
        break;
    }
  }

  return sections;
};

const formatOutput = ({
  domain,
  resolver,
  sections,
}: {
  domain: string;
  resolver: string;
  sections: Section[];
}): string => {
  const lines: string[] = [];
  lines.push(`Domain    : ${domain}`);
  lines.push(`DNS Server: ${resolver}`);
  lines.push("");

  sections.forEach((section, index) => {
    lines.push(`[+] ${section.title}`);
    const contentLines =
      section.lines && section.lines.length
        ? section.lines
        : ["Tidak ada data"];
    contentLines.forEach((line) => {
      lines.push(`    ${line}`);
    });
    if (index < sections.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
};

export type DnsCheckResult = {
  domain: string;
  resolver: string;
  sections: Section[];
  output: string;
  cached: boolean;
};

export const runDnsCheck = async (
  rawInput: string
): Promise<DnsCheckResult> => {
  const { domain, resolver, recordOrder } = parseInput(rawInput);
  const effectiveResolver = resolver || DEFAULT_RESOLVER;
  const cacheKey = makeCacheKey({
    domain,
    resolver: effectiveResolver,
    recordOrder: recordOrder || null,
  });

  const cachedResult = getCachedResult(cacheKey);
  if (cachedResult) {
    return { ...cachedResult, cached: true };
  }

  const resolverClient = createResolver(resolver);
  const resolverUsed =
    (resolverClient.getServers()[0] as string) || effectiveResolver;

  const sections = await buildSections({
    domain,
    resolverClient,
    recordOrder,
  });

  const baseResult = {
    domain,
    resolver: resolverUsed,
    sections,
    output: formatOutput({ domain, resolver: resolverUsed, sections }),
  };

  setCachedResult(cacheKey, baseResult);

  return { ...baseResult, cached: false };
};
