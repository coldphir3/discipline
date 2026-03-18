import { uid } from "./state.js";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

function isRideActivity(activity) {
  const type = String(activity.sport_type || activity.type || "");
  return type.includes("Ride") || type === "VirtualRide";
}

function normalizeRide(activity) {
  return {
    id: `strava_${activity.id || uid("ride")}`,
    source: "strava",
    stravaId: String(activity.id || ""),
    name: activity.name || "Strava ride",
    startAt: activity.start_date_local || activity.start_date || new Date().toISOString(),
    distanceKm: Number(activity.distance || 0) / 1000,
    movingTimeMin: Math.round(Number(activity.moving_time || 0) / 60),
    elevationM: Math.round(Number(activity.total_elevation_gain || 0)),
    note: ""
  };
}

async function stravaGet(path, accessToken) {
  const response = await fetch(`${STRAVA_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Strava request failed (${response.status}). ${body || "No error body returned."}`);
  }

  return response.json();
}

export async function syncStravaRides({ accessToken, afterEpochSeconds = 0, pageLimit = 3 } = {}) {
  if (!accessToken) {
    throw new Error("A Strava access token is required to sync rides.");
  }

  const athlete = await stravaGet("/athlete", accessToken);
  const rides = [];

  for (let page = 1; page <= pageLimit; page += 1) {
    const afterQuery = afterEpochSeconds ? `&after=${afterEpochSeconds}` : "";
    const activities = await stravaGet(`/athlete/activities?page=${page}&per_page=100${afterQuery}`, accessToken);
    const rideActivities = activities.filter(isRideActivity).map(normalizeRide);
    rides.push(...rideActivities);
    if (activities.length < 100) break;
  }

  return {
    athleteName: [athlete.firstname, athlete.lastname].filter(Boolean).join(" ").trim(),
    rides
  };
}

export function mergeStravaRides(existingRides, importedRides) {
  const importedByStravaId = new Map(importedRides.filter((ride) => ride.stravaId).map((ride) => [ride.stravaId, ride]));
  const merged = [];

  for (const ride of existingRides) {
    if (ride.source !== "strava") {
      merged.push(ride);
      continue;
    }

    const fresh = importedByStravaId.get(ride.stravaId);
    if (fresh) {
      merged.push({ ...fresh, note: ride.note || fresh.note || "" });
      importedByStravaId.delete(ride.stravaId);
    } else {
      merged.push(ride);
    }
  }

  for (const ride of importedByStravaId.values()) {
    merged.push(ride);
  }

  return merged.sort((left, right) => new Date(right.startAt).getTime() - new Date(left.startAt).getTime());
}
