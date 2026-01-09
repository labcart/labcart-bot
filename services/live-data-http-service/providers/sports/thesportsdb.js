/**
 * TheSportsDB API Provider (Fallback)
 *
 * Free API with documented endpoints.
 * Requires API key (free tier available).
 *
 * Docs: https://www.thesportsdb.com/api.php
 */

import fetch from 'node-fetch';

// TheSportsDB league IDs
const LEAGUE_IDS = {
  'nba': '4387',
  'nfl': '4391',
  'mlb': '4424',
  'nhl': '4380',
  'epl': '4328',
  'laliga': '4335',
  'bundesliga': '4331',
  'seriea': '4332',
  'ligue1': '4334',
  'mls': '4346',
};

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';

export class TheSportsDBProvider {
  constructor(config = {}) {
    this.name = 'thesportsdb';
    this.apiKey = config.apiKey || process.env.THESPORTSDB_API_KEY || '1'; // '1' is test key
    this.config = config;
  }

  /**
   * Get scores/events for a league on a specific date
   */
  async getScores(sport, date, team = null) {
    const leagueId = LEAGUE_IDS[sport?.toLowerCase()];

    if (!leagueId) {
      // Try to get events by team search if league not found
      if (team) {
        return this.searchTeamEvents(team);
      }
      throw new Error(`Unsupported sport: ${sport}. Supported: ${Object.keys(LEAGUE_IDS).join(', ')}`);
    }

    // TheSportsDB uses different endpoints for different scenarios
    // For recent events: eventsround.php or eventspastleague.php

    let url;
    if (date) {
      // Events on specific date
      url = `${BASE_URL}/${this.apiKey}/eventsday.php?d=${this.formatDate(date)}&l=${leagueId}`;
    } else {
      // Last 15 events for league
      url = `${BASE_URL}/${this.apiKey}/eventspastleague.php?id=${leagueId}`;
    }

    console.log(`🏈 [TheSportsDB] Fetching: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TheSportsDB API error: ${response.status}`);
    }

    const data = await response.json();
    return this.parseEvents(data, sport, team);
  }

  /**
   * Search for team events
   */
  async searchTeamEvents(teamName) {
    const url = `${BASE_URL}/${this.apiKey}/searchteams.php?t=${encodeURIComponent(teamName)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TheSportsDB search error: ${response.status}`);
    }

    const data = await response.json();
    const team = data.teams?.[0];

    if (!team) {
      return { games: [], games_count: 0, error: `Team not found: ${teamName}` };
    }

    // Get last 5 events for the team
    const eventsUrl = `${BASE_URL}/${this.apiKey}/eventslast.php?id=${team.idTeam}`;
    const eventsResponse = await fetch(eventsUrl);
    const eventsData = await eventsResponse.json();

    return this.parseEvents(eventsData, team.strSport, null);
  }

  /**
   * Parse TheSportsDB events response
   */
  parseEvents(data, sport, teamFilter) {
    const events = data.events || data.results || [];

    let games = events.map(event => {
      // Determine status
      let status = 'scheduled';
      if (event.strStatus === 'Match Finished' || event.intHomeScore !== null) {
        status = 'final';
      } else if (event.strStatus === 'In Progress') {
        status = 'live';
      }

      return {
        id: event.idEvent,
        name: event.strEvent,
        date: event.dateEvent,
        time: event.strTime,
        status: status,
        status_detail: event.strStatus,
        home: {
          id: event.idHomeTeam,
          name: event.strHomeTeam,
          score: event.intHomeScore ? parseInt(event.intHomeScore, 10) : null,
        },
        away: {
          id: event.idAwayTeam,
          name: event.strAwayTeam,
          score: event.intAwayScore ? parseInt(event.intAwayScore, 10) : null,
        },
        venue: event.strVenue,
        league: event.strLeague,
      };
    });

    // Filter by team if specified
    if (teamFilter) {
      const filterLower = teamFilter.toLowerCase();
      games = games.filter(game => {
        const homeName = game.home.name?.toLowerCase() || '';
        const awayName = game.away.name?.toLowerCase() || '';
        return homeName.includes(filterLower) || awayName.includes(filterLower);
      });
    }

    return {
      sport: sport,
      games_count: games.length,
      games: games,
    };
  }

  /**
   * Format date for TheSportsDB API (YYYY-MM-DD)
   */
  formatDate(yyyymmdd) {
    if (yyyymmdd.length === 8) {
      return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
    }
    return yyyymmdd;
  }
}

export default TheSportsDBProvider;
