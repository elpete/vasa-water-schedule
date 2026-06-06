const express = require("express");
const cheerio = require("cheerio");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";
const VASA_BASE = "https://vasafitness.com";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

app.use(express.static("public"));

function decodeText(value = "") {
  return cheerio.load(`<span>${value}</span>`)("span").text().replace(/\s+/g, " ").trim();
}

function scheduleUrlFromLocationUrl(locationUrl) {
  const path = new URL(locationUrl).pathname.replace(/^\/|\/$/g, "");
  const slug = path.split("/").pop();
  return `${VASA_BASE}/classes-in-${slug}/`;
}

function selectedDayFromDate(dateValue) {
  const date = dateValue ? new Date(`${dateValue}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return DAY_NAMES[new Date().getDay()];
  return DAY_NAMES[date.getDay()];
}

function milesBetween(origin, destination) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(destination.lat - origin.lat);
  const lngDelta = toRadians(destination.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lngDelta / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "Mozilla/5.0 VASA schedule viewer",
      accept: "text/html,application/xhtml+xml,application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request returned ${response.status} for ${url}`);
  }

  return response.text();
}

async function geocodeZip(zip) {
  const json = await fetchText(`https://api.zippopotam.us/us/${zip}`, {
    headers: { accept: "application/json" },
  });
  const data = JSON.parse(json);
  const place = data.places?.[0];

  if (!place) {
    throw new Error(`Could not locate ZIP ${zip}.`);
  }

  return {
    lat: Number(place.latitude),
    lng: Number(place.longitude),
    label: `${place["place name"]}, ${place["state abbreviation"]}`,
  };
}

async function searchLocations(zip) {
  const body = new URLSearchParams({
    action: "vasa_search_location",
    search: zip,
    searchType: "default",
  });

  const html = await fetchText(`${VASA_BASE}/wp-admin/admin-ajax.php`, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  const $ = cheerio.load(html);
  return $(".result")
    .map((_, result) => {
      const $result = $(result);
      const locationUrl = $result.find(".location-links a").attr("href");
      const comingSoon = decodeText($result.find(".coming-soon").text());
      const markerColor = $result.find(".map-data").attr("data-icon-color") || "";

      return {
        id: $result.find(".change-location").attr("data-location-id") || "",
        name: decodeText($result.find(".location-name").text()),
        address: decodeText($result.find(".location-address").text()),
        locationUrl,
        scheduleUrl: locationUrl ? scheduleUrlFromLocationUrl(locationUrl) : "",
        lat: Number($result.find(".map-data").attr("data-latt")),
        lng: Number($result.find(".map-data").attr("data-lngg")),
        comingSoon: Boolean(comingSoon) || markerColor === "gray",
      };
    })
    .get()
    .filter((location) => location.name && location.locationUrl && !location.comingSoon);
}

function matchesActivity(activity, classList, values) {
  if (activity === "all") return true;

  const haystack = values.join(" ").toLowerCase();
  if (activity === "water") {
    return classList.includes("aqua") || /\b(aqua|water|pool|swim)\b/.test(haystack);
  }

  return true;
}

function parseClasses(html, day, activity = "all") {
  const $ = cheerio.load(html);
  const pageTitle = decodeText($(".schedule-title").first().text()) || decodeText($("h1").first().text());
  const address = decodeText($(".cat-class-sub-location-name").first().text());
  const classes = [];

  $("button.cs-class").each((_, button) => {
    const $button = $(button);
    const classList = ($button.attr("class") || "").split(/\s+/);
    if (!classList.includes(day)) return;

    const title = decodeText($button.find(".cs-class-title.red").first().text());
    const subtitle = decodeText($button.find(".cs-class-subtitle").first().text());
    const instructor =
      decodeText($button.find(".cs-class-instructor.show-for-large").first().text()) ||
      decodeText($button.find(".cs-class-instructor-mobile").first().text());
    const time = decodeText($button.attr("data-cs_times") || $button.find(".cs-class-time").first().text());
    const description = decodeText($button.find(".hidden-cat-desc").first().text());
    const available = decodeText($button.attr("data-cs_available") || "");
    const capacity = decodeText($button.attr("data-cs_max_cap") || "");
    const room = decodeText($button.attr("data-cs_room_name") || title);
    const canceled = classList.includes("canceled") || classList.includes("cancelled");

    if ((title || subtitle || time) && matchesActivity(activity, classList, [title, subtitle, room, description])) {
      classes.push({ title, subtitle, instructor, time, description, available, capacity, room, canceled, categories: classList });
    }
  });

  classes.sort((a, b) => Date.parse(`2000-01-01 ${a.time.split(" - ")[0]}`) - Date.parse(`2000-01-01 ${b.time.split(" - ")[0]}`));

  return { pageTitle, address, classes };
}

app.get("/api/schedules", async (req, res) => {
  const zip = String(req.query.zip || "").trim();
  const date = String(req.query.date || "").trim();
  const activity = ["all", "water"].includes(String(req.query.activity || "")) ? String(req.query.activity) : "water";
  const miles = Math.min(Math.max(Number(req.query.miles) || 25, 5), 100);

  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ error: "Enter a valid 5-digit ZIP code." });
  }

  try {
    const day = selectedDayFromDate(date);
    const origin = await geocodeZip(zip);
    const locations = (await searchLocations(zip))
      .map((location) => ({
        ...location,
        distanceMiles: Number(milesBetween(origin, location).toFixed(1)),
      }))
      .filter((location) => location.distanceMiles <= miles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
    const schedules = await Promise.all(
      locations.map(async (location) => {
        try {
          const html = await fetchText(location.scheduleUrl);
          const parsed = parseClasses(html, day, activity);
          return { ...location, ...parsed, error: null };
        } catch (error) {
          return { ...location, pageTitle: "", classes: [], error: error.message };
        }
      })
    );

    res.json({
      zip,
      date: date || new Date().toISOString().slice(0, 10),
      day,
      activity,
      miles,
      origin,
      generatedAt: new Date().toISOString(),
      schedules,
      note: "VASA publishes schedule pages as a weekly day grid; this tool filters the visible VASA schedule by the weekday of the selected date.",
    });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.listen(port, host, () => {
  console.log(`VASA schedule viewer running at http://${host}:${port}`);
});
