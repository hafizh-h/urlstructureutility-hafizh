const puppeteer = require("puppeteer");
// URL object structure:
// - url: the URL to test (required)
// - target: expected final URL after redirect (required)
// - expectedCurrency: expected tiket_currency cookie value (optional)
// - expectedCanonical: expected canonical link URL (optional)
// - hrefLang: expected x-default hreflang URL (optional)

const SITE_CONFIG = {
  // Targeted countries (Expected Status: 200 OK)
  supportedCountries: ['id', 'sg', 'my', 'th', 'us'], 

  // Non-Targeted countries but supported currency (Expected Status: 302 Found)
  currencyOnlyCountries: ['gb', 'au', 'nz' , 'jp', 'ca', 'ch', 'cn', 
    'hk', 'ph', 'vn', 'at', 'be', 'cy', 'ee', 'fi', 'fr', 'de', 'gr', 
    'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pt', 'sk', 'si', 'es'],
};

function getExpectedRedirectStatus(sourceUrl) {
  const lowerUrl = sourceUrl.toLowerCase();

  if (lowerUrl.includes('//m.') || lowerUrl.includes('//en.')) {
    return 301;
  }

  const countryCodeMatch = lowerUrl.match(/\/([a-z]{2})-([a-z]{2})(\/|$)/);

  if (!countryCodeMatch) {
    return 301;
  }

  const countryCode = countryCodeMatch[2]; // e.g., 'sg', 'id', 'jp'

  const isSupportedCountry = SITE_CONFIG.supportedCountries
    .map(c => c.toLowerCase())
    .includes(countryCode);

  const isCurrencyOnly = SITE_CONFIG.currencyOnlyCountries
    .map(c => c.toLowerCase()) 
    .includes(countryCode);

  if (isSupportedCountry) {
    const originalSlugMatch = sourceUrl.match(/\/([a-zA-Z]{2})-([a-zA-Z]{2})(\/|$)/);
    
    if (originalSlugMatch && originalSlugMatch[0] !== originalSlugMatch[0].toLowerCase()) {
        return 302;
    }
    
    return 200;
  }

  if (isCurrencyOnly) {
    return 302;
  }

  return 301;
}

const urls = require('./urls.json');

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  bgYellow: "\x1b[43m",
};

var browser = null;
var page = null;

// Function to display value with expected/unexpected/not found status
function displayValueStatus(value, expectedValue = null) {
  // Check if value is null or undefined
  if (value === null || value === undefined) {
    return `${colors.red}Not Found${colors.reset}`;
  }
  
  // If no expected value is provided, just show the value
  if (expectedValue === null || expectedValue === undefined) {
    return `${colors.cyan}${value}${colors.reset}`;
  }
  
  // Check if value matches expected value
  if (value === expectedValue) {
    return `${colors.green}Expected${colors.reset} (${colors.cyan}${value}${colors.reset})`;
  } else {
    return `${colors.red}Unexpected${colors.reset} (${colors.yellow}${value}${colors.reset}, expected: ${colors.cyan}${expectedValue}${colors.reset})`;
  }
}

// Cleanup function to ensure browser is properly closed
async function cleanup() {
  console.log(
    `\n${colors.yellow}${colors.bright}🧹 Cleaning up browser processes...${colors.reset}`
  );
  try {
    if (page) {
      await page.close();
      page = null;
    }
    if (browser) {
      const pages = await browser.pages();
      await Promise.all(pages.map((p) => p.close().catch(() => {})));
      await browser.close();
      browser = null;
    }
    console.log(
      `${colors.green}${colors.bright}✓ Browser closed successfully${colors.reset}`
    );
  } catch (error) {
    console.error(
      `${colors.red}${colors.bright}✗ Error during cleanup:${colors.reset} ${error.message}`
    );
    // Force kill the browser process if normal close fails
    if (browser && browser.process()) {
      browser.process().kill("SIGKILL");
    }
  }
}

// Handle process termination signals
process.on("SIGINT", async () => {
  console.log(
    `\n${colors.yellow}${colors.bright}⚠️  Received SIGINT. Shutting down gracefully...${colors.reset}`
  );
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log(
    `\n${colors.yellow}${colors.bright}⚠️  Received SIGTERM. Shutting down gracefully...${colors.reset}`
  );
  await cleanup();
  process.exit(0);
});

process.on("uncaughtException", async (error) => {
  console.error(
    `${colors.red}${colors.bright}✗ Uncaught Exception:${colors.reset} ${error.message}`
  );
  await cleanup();
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error(
    `${colors.red}${colors.bright}✗ Unhandled Rejection:${colors.reset}`,
    reason
  );
  await cleanup();
  process.exit(1);
});

async function getUrlStatusAndFinalUrl(url) {
  try {
    const response = await page.goto(url.url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    
    const chain = response.request().redirectChain();
    let initialStatus = null;

    if (chain.length > 0) {
      const firstRequest = chain[0];
      const firstResponse = firstRequest.response();
      if (firstResponse) {
        initialStatus = firstResponse.status();
      }
    } else {
      initialStatus = response.status();
    }

    const finalStatusCode = response.status();
    const finalUrl = page.url();
    const isTargetUrlMatch = url.target === finalUrl;

    const expectedRedirectCode = getExpectedRedirectStatus(url.url);
    
    let isRedirectCorrect = true;
    if (expectedRedirectCode) {
        if (expectedRedirectCode === 200) {
            isRedirectCorrect = (chain.length === 0 && finalStatusCode === 200);
            if (chain.length > 0 && chain[0].response()) {
                initialStatus = chain[0].response().status(); 
            }
        } else {
            isRedirectCorrect = (initialStatus === expectedRedirectCode);
        }
    }

    // Get cookies
    const cookies = await page.cookies();
    const tiketCurrencyCookie = cookies.find(
      (cookie) => cookie.name === "tiket_currency"
    );

    // Get meta tags, canonical link, and hreflang from head
    const { metaTags, canonicalUrl, hreflangXDefault } = await page.evaluate(() => {
      const metas = {};
      const metaElements = document.querySelectorAll("head meta");

      metaElements.forEach((meta) => {
        const name =
          meta.getAttribute("name") ||
          meta.getAttribute("property") ||
          meta.getAttribute("http-equiv");
        const content = meta.getAttribute("content");

        if (name && content) {
          metas[name] = content;
        }
      });

      // Get canonical link element
      const canonicalLink = document.querySelector('link[rel="canonical"]');
      const canonical = canonicalLink ? canonicalLink.getAttribute("href") : null;

      // Get x-default hreflang link
      const hreflangXDefaultLink = document.querySelector(
        'link[rel="alternate"][hreflang="x-default"]'
      );
      const xDefault = hreflangXDefaultLink
        ? hreflangXDefaultLink.getAttribute("href")
        : null;

      return { metaTags: metas, canonicalUrl: canonical, hreflangXDefault: xDefault };
    });

    // Display results
    console.log(
      `\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.blue}🔗 Source URL:${colors.reset} ${colors.yellow}${url.url}${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.blue}🔗 Target URL:${colors.reset} ${colors.yellow}${url.target}${colors.reset}`
    );

    if (expectedRedirectCode) {
        const statusColor = isRedirectCorrect ? colors.green : colors.red;
        const icon = isRedirectCorrect ? "✓" : "✗";
        console.log(
            `${colors.bright}${colors.magenta}↪️  Redirect Check:${colors.reset} ${statusColor}${icon} ${initialStatus}${colors.reset} (Expected: ${expectedRedirectCode})`
        );
    } else if (chain.length > 0) {
        console.log(
            `${colors.bright}${colors.magenta}↪️  Redirect Status:${colors.reset} ${colors.yellow}${initialStatus}${colors.reset} (No rule defined)`
        );
    }

    console.log(
      `${colors.bright}${colors.green}✓ Status Code:${colors.reset} ${
        finalStatusCode >= 200 && finalStatusCode < 300
          ? colors.green
          : finalStatusCode >= 300 && finalStatusCode < 400
          ? colors.yellow
          : colors.red
      }${finalStatusCode}${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.magenta}→ Final URL:${colors.reset} ${colors.cyan}${finalUrl}${colors.reset}`
    );
    console.log(
      `${colors.bright}📖${colors.bgYellow}Status:${colors.reset} ${
        isTargetUrlMatch ? colors.green : colors.red
      }${isTargetUrlMatch ? "SAME" : "DIFF"}${colors.reset}`
    );

    // Display cookie information
    const currencyValue = tiketCurrencyCookie?.value;
    const expectedCurrency = url.expectedCurrency || null;
    console.log(
      `${colors.bright}${colors.blue}🍪 tiket_currency Cookie:${colors.reset} ${displayValueStatus(currencyValue, expectedCurrency)}`
    );

    // Display canonical link
    const expectedCanonical = url.expectedCanonical || null;
    console.log(
      `${colors.bright}${colors.blue}🔗 Canonical Link:${colors.reset} ${displayValueStatus(canonicalUrl, expectedCanonical)}`
    );

    // Display x-default hreflang
    const expectedHreflang = url.hrefLang || null;
    console.log(
      `${colors.bright}${colors.blue}🌐 Hreflang x-default:${colors.reset} ${displayValueStatus(hreflangXDefault, expectedHreflang)}`
    );

    // Display important meta tags
    const importantMetaTags = [
      "robots",
      "canonical",
    ];

    const foundMetaTags = importantMetaTags.filter(tag => metaTags[tag]);
    
    if (foundMetaTags.length > 0) {
      console.log(
        `${colors.bright}${colors.blue}📋 Meta Tags:${colors.reset}`
      );
      foundMetaTags.forEach((tag) => {
        const displayValue =
          metaTags[tag].length > 80
            ? metaTags[tag].substring(0, 77) + "..."
            : metaTags[tag];
        console.log(
          `   ${colors.cyan}${tag}:${colors.reset} ${displayValue}`
        );
      });
    }

    console.log(
      `${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );

    return {
      statusCode: finalStatusCode,
      initialStatus, 
      finalUrl,
      isRedirectCorrect,
      cookies: {
        tiket_currency: tiketCurrencyCookie?.value || null,
        all: cookies,
      },
      canonicalUrl,
      hreflangXDefault,
      metaTags,
      isPassed: isTargetUrlMatch && isRedirectCorrect,
    };
  } catch (error) {
    console.error(
      `${colors.red}${colors.bright}✗ Error fetching the URL:${colors.reset} ${colors.red}${error.message}${colors.reset}`
    );
    return { error: error.message };
  }
}

(async () => {
  try {
    console.log(
      `${colors.bright}${colors.cyan}🚀 Starting URL status checker...${colors.reset}\n`
    );

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--dns-prefetch-disable",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-dev-shm-usage", // Overcome limited resource problems
        "--disable-gpu", // Applicable to Windows, no-op on other OSes
        "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      ],
    });

    console.log(
      `${colors.green}${colors.bright}✓ Browser launched successfully${colors.reset}`
    );

    page = await browser.newPage();

    // Set default timeout
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    console.log(
      `${colors.bright}${colors.blue}📝 Testing ${urls.length} URLs...${colors.reset}\n`
    );

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < urls.length; i++) {
      console.log(
        `${colors.bright}${colors.magenta}[${i + 1}/${urls.length}]${colors.reset}`
      );
      const result = await getUrlStatusAndFinalUrl(urls[i]);
      if (result.error) {
        failureCount++;
      } else if (result.isPassed) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    // Summary
    console.log(
      `\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.blue}📊 SUMMARY:${colors.reset}`
    );
    console.log(
      `   ${colors.green}✓ Passed: ${successCount}${colors.reset}`
    );
    console.log(
      `   ${colors.red}✗ Failed: ${failureCount}${colors.reset}`
    );
    console.log(
      `   ${colors.cyan}Total: ${urls.length}${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`
    );
  } catch (error) {
    console.error(
      `${colors.red}${colors.bright}✗ Fatal error:${colors.reset} ${error.message}`
    );
    console.error(error.stack);
  } finally {
    // Always cleanup, even if there's an error
    await cleanup();
  }
})();