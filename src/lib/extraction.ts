import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import type {
  DebugArtifacts,
  ExtractedKeyValue,
  ExtractedTable,
} from "../types.js";

type PageExtraction = {
  pageTitle: string;
  pageUrl: string;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  rawTextPreview: string;
};

export async function extractPageSnapshot(page: Page): Promise<PageExtraction> {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();

    const isVisible = (element: Element): boolean => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const unique = <T,>(items: T[], keyFn: (item: T) => string): T[] => {
      const seen = new Set<string>();
      const result: T[] = [];

      for (const item of items) {
        const key = keyFn(item);

        if (!key || seen.has(key)) {
          continue;
        }

        seen.add(key);
        result.push(item);
      }

      return result;
    };

    const headings = unique(
      Array.from(document.querySelectorAll("h1, h2, h3, h4"))
        .filter(isVisible)
        .map((element) => normalize(element.textContent))
        .filter((text) => text.length > 0)
        .slice(0, 40),
      (item) => item,
    );

    const keyValues = unique(
      Array.from(document.querySelectorAll("dl"))
        .filter(isVisible)
        .flatMap((dl) => {
          const dts = Array.from(dl.querySelectorAll(":scope > dt"));
          const dds = Array.from(dl.querySelectorAll(":scope > dd"));

          return dts.map((dt, index) => ({
            label: normalize(dt.textContent),
            value: normalize(dds[index]?.textContent),
          }));
        })
        .filter((item) => item.label && item.value)
        .slice(0, 100),
      (item) => `${item.label}::${item.value}`,
    );

    const tables = Array.from(document.querySelectorAll("table"))
      .filter(isVisible)
      .map((table) => {
        const caption = normalize(table.querySelector("caption")?.textContent);
        const section = table.closest("section, article, div");
        const sectionHeading =
          normalize(
            section?.querySelector("h1, h2, h3, h4, strong")?.textContent,
          ) || undefined;

        const rows = Array.from(table.querySelectorAll("tr"))
          .map((row) =>
            Array.from(row.querySelectorAll("th, td"))
              .map((cell) => normalize(cell.textContent))
              .filter((value) => value.length > 0),
          )
          .filter((row) => row.length > 0);

        const headers =
          Array.from(table.querySelectorAll("thead th"))
            .map((cell) => normalize(cell.textContent))
            .filter((value) => value.length > 0) || [];

        const effectiveHeaders =
          headers.length > 0 ? headers : rows.length > 0 ? rows[0] ?? [] : [];

        let bodyRows =
          headers.length > 0 ? rows : rows.length > 0 ? rows.slice(1) : rows;

        if (
          bodyRows.length > 0 &&
          (bodyRows[0] ?? []).length === effectiveHeaders.length &&
          (bodyRows[0] ?? []).every(
            (value, index) => value === effectiveHeaders[index],
          )
        ) {
          bodyRows = bodyRows.slice(1);
        }

        const title = caption || sectionHeading || undefined;

        return {
          headers: effectiveHeaders,
          rows: bodyRows.slice(0, 50),
          rowCount: bodyRows.length,
          ...(title ? { title } : {}),
        };
      })
      .filter((table) => table.headers.length > 0 || table.rows.length > 0)
      .slice(0, 30);

    const rawTextPreview = normalize(document.body?.innerText).slice(0, 5_000);

    return {
      pageTitle: document.title,
      pageUrl: location.href,
      headings,
      keyValues,
      tables,
      rawTextPreview,
    };
  });
}

export async function extractTablesBySelectors(
  page: Page,
  selectors: string[],
): Promise<ExtractedTable[]> {
  return page.evaluate((rawSelectors) => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();

    const tables = rawSelectors
      .map((selector) => {
        const table = document.querySelector(selector);

        if (!(table instanceof HTMLTableElement)) {
          return null;
        }

        const rows = Array.from(table.querySelectorAll("tr"))
          .map((row) =>
            Array.from(row.querySelectorAll("th, td"))
              .map((cell) => normalize(cell.textContent))
              .filter((value) => value.length > 0),
          )
          .filter((row) => row.length > 0);

        const headers =
          Array.from(table.querySelectorAll("thead th"))
            .map((cell) => normalize(cell.textContent))
            .filter((value) => value.length > 0) || [];

        const effectiveHeaders =
          headers.length > 0 ? headers : rows.length > 0 ? rows[0] ?? [] : [];

        let bodyRows =
          headers.length > 0 ? rows : rows.length > 0 ? rows.slice(1) : rows;

        if (
          bodyRows.length > 0 &&
          (bodyRows[0] ?? []).length === effectiveHeaders.length &&
          (bodyRows[0] ?? []).every(
            (value, index) => value === effectiveHeaders[index],
          )
        ) {
          bodyRows = bodyRows.slice(1);
        }

        const caption = normalize(table.querySelector("caption")?.textContent);

        const extracted: ExtractedTable = {
          headers: effectiveHeaders,
          rows: bodyRows.slice(0, 100),
          rowCount: bodyRows.length,
          ...(caption || selector ? { title: caption || selector } : {}),
        };

        return extracted;
      })
      .filter((table) => table !== null);

    return tables as ExtractedTable[];
  }, selectors);
}

function makeSafeTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

export async function saveDebugArtifacts(
  page: Page,
  debugDir: string,
  prefix: string,
): Promise<DebugArtifacts> {
  await mkdir(debugDir, { recursive: true });

  const timestamp = makeSafeTimestamp(new Date());
  const htmlPath = path.join(debugDir, `${prefix}-${timestamp}.html`);
  const screenshotPath = path.join(debugDir, `${prefix}-${timestamp}.png`);

  await writeFile(htmlPath, await page.content(), "utf8");
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  return {
    htmlPath,
    screenshotPath,
  };
}
