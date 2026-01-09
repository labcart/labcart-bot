/**
 * ESPN Hidden API Provider
 *
 * Uses ESPN's unofficial but publicly accessible API endpoints.
 * No authentication required.
 *
 * Endpoints: https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
 */

import fetch from 'node-fetch';

// Sport to ESPN API path mapping
const SPORT_MAPPINGS = {
  'nba': { sport: 'basketball', league: 'nba' },
  'nfl': { sport: 'football', league: 'nfl' },
  'mlb': { sport: 'baseball', league: 'mlb' },
  'nhl': { sport: 'hockey', league: 'nhl' },
  'ncaaf': { sport: 'football', league: 'college-football' },
  'ncaab': { sport: 'basketball', league: 'mens-college-basketball' },
  'wnba': { sport: 'basketball', league: 'wnba' },
  'mls': { sport: 'soccer', league: 'usa.1' },
  'soccer': { sport: 'soccer', league: 'eng.1' }, // Default to Premier League
  'epl': { sport: 'soccer', league: 'eng.1' },
  'laliga': { sport: 'soccer', league: 'esp.1' },
  'bundesliga': { sport: 'soccer', league: 'ger.1' },
  'seriea': { sport: 'soccer', league: 'ita.1' },
  'ligue1': { sport: 'soccer', league: 'fra.1' },
};

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE_API_URL = 'https://sports.core.api.espn.com/v2/sports';

export class ESPNProvider {
  constructor(config = {}) {
    this.name = 'espn';
    this.config = config;
  }

  /**
   * Fetch odds for a specific event
   */
  async getOddsForEvent(sport, league, eventId) {
    const url = `${CORE_API_URL}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/odds`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const items = data.items || [];

      // Get first provider's odds (usually DraftKings)
      const oddsData = items[0];
      if (!oddsData) return null;

      return {
        provider: oddsData.provider?.name || 'Unknown',
        spread: oddsData.spread,
        spread_display: oddsData.details,
        over_under: oddsData.overUnder,
        over_odds: oddsData.overOdds,
        under_odds: oddsData.underOdds,
        home_moneyline: oddsData.homeTeamOdds?.moneyLine,
        away_moneyline: oddsData.awayTeamOdds?.moneyLine,
        home_spread_odds: oddsData.homeTeamOdds?.spreadOdds,
        away_spread_odds: oddsData.awayTeamOdds?.spreadOdds,
        favorite: oddsData.awayTeamOdds?.favorite ? 'away' : 'home',
      };
    } catch (error) {
      console.warn(`⚠️ [ESPN] Failed to fetch odds for event ${eventId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get scores for a sport on a specific date
   */
  async getScores(sport, date, team = null, league = null) {
    // Resolve sport mapping
    const mapping = SPORT_MAPPINGS[sport?.toLowerCase()];
    if (!mapping) {
      throw new Error(`Unsupported sport: ${sport}. Supported: ${Object.keys(SPORT_MAPPINGS).join(', ')}`);
    }

    // Allow league override for soccer
    const finalLeague = league || mapping.league;

    // Build URL
    const url = new URL(`${BASE_URL}/${mapping.sport}/${finalLeague}/scoreboard`);

    // Add date if provided (format: YYYYMMDD)
    if (date) {
      url.searchParams.set('dates', date);
    }

    console.log(`🏀 [ESPN] Fetching: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Parse ESPN response into clean format
    return this.parseScoreboard(data, team, sport, mapping);
  }

  /**
   * Parse ESPN scoreboard response
   */
  async parseScoreboard(data, teamFilter, sport, mapping) {
    const events = data.events || [];

    // Fetch odds for all scheduled/live games in parallel
    const oddsPromises = events.map(async (event) => {
      const status = event.status?.type;
      // Only fetch odds for scheduled or live games
      if (status?.completed) {
        return { eventId: event.id, odds: null };
      }
      const odds = await this.getOddsForEvent(mapping.sport, mapping.league, event.id);
      return { eventId: event.id, odds };
    });

    const oddsResults = await Promise.all(oddsPromises);
    const oddsMap = new Map(oddsResults.map(r => [r.eventId, r.odds]));

    let games = events.map(event => {
      const competition = event.competitions?.[0];
      if (!competition) return null;

      const competitors = competition.competitors || [];
      const homeTeam = competitors.find(c => c.homeAway === 'home');
      const awayTeam = competitors.find(c => c.homeAway === 'away');

      // Determine game status
      const status = event.status?.type;
      let gameStatus = 'scheduled';
      if (status?.completed) {
        gameStatus = 'final';
      } else if (status?.state === 'in') {
        gameStatus = 'live';
      } else if (status?.state === 'pre') {
        gameStatus = 'scheduled';
      }

      // Get scores (may be null for scheduled games)
      const homeScore = homeTeam?.score ? parseInt(homeTeam.score, 10) : null;
      const awayScore = awayTeam?.score ? parseInt(awayTeam.score, 10) : null;

      // Get odds for this game
      const odds = oddsMap.get(event.id);

      return {
        id: event.id,
        name: event.name,
        short_name: event.shortName,
        date: event.date,
        status: gameStatus,
        status_detail: status?.shortDetail || status?.description,
        home: {
          id: homeTeam?.team?.id,
          name: homeTeam?.team?.displayName,
          abbreviation: homeTeam?.team?.abbreviation,
          logo: homeTeam?.team?.logo,
          score: homeScore,
          winner: homeTeam?.winner,
        },
        away: {
          id: awayTeam?.team?.id,
          name: awayTeam?.team?.displayName,
          abbreviation: awayTeam?.team?.abbreviation,
          logo: awayTeam?.team?.logo,
          score: awayScore,
          winner: awayTeam?.winner,
        },
        venue: competition.venue?.fullName,
        broadcast: competition.broadcasts?.[0]?.names?.join(', '),
        odds: odds,
      };
    }).filter(Boolean);

    // Filter by team if specified
    if (teamFilter) {
      const filterLower = teamFilter.toLowerCase();
      games = games.filter(game => {
        const homeName = game.home.name?.toLowerCase() || '';
        const homeAbbr = game.home.abbreviation?.toLowerCase() || '';
        const awayName = game.away.name?.toLowerCase() || '';
        const awayAbbr = game.away.abbreviation?.toLowerCase() || '';

        return (
          homeName.includes(filterLower) ||
          homeAbbr.includes(filterLower) ||
          awayName.includes(filterLower) ||
          awayAbbr.includes(filterLower)
        );
      });
    }

    return {
      sport: sport,
      league: data.leagues?.[0]?.abbreviation || sport.toUpperCase(),
      date: data.day?.date,
      games_count: games.length,
      games: games,
    };
  }

  /**
   * Get available leagues
   */
  getAvailableLeagues() {
    return Object.entries(SPORT_MAPPINGS).map(([key, value]) => ({
      key,
      sport: value.sport,
      league: value.league,
    }));
  }

  /**
   * Get injuries for a sport/team
   */
  async getInjuries(sport, team = null) {
    const mapping = SPORT_MAPPINGS[sport?.toLowerCase()];
    if (!mapping) {
      throw new Error(`Unsupported sport: ${sport}`);
    }

    const url = `${BASE_URL}/${mapping.sport}/${mapping.league}/injuries`;
    console.log(`🏥 [ESPN] Fetching injuries: ${url}`);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)' },
    });

    if (!response.ok) {
      throw new Error(`ESPN injuries API error: ${response.status}`);
    }

    const data = await response.json();
    let teams = data.injuries || [];

    // Filter by team if specified
    if (team) {
      const teamLower = team.toLowerCase();
      teams = teams.filter(t =>
        t.displayName?.toLowerCase().includes(teamLower) ||
        t.id === team
      );
    }

    // Parse injuries
    const result = teams.map(t => ({
      team_id: t.id,
      team: t.displayName,
      injuries: (t.injuries || []).map(i => ({
        player: i.athlete?.displayName,
        position: i.athlete?.position?.abbreviation,
        status: i.status,
        injury: i.shortComment || i.longComment,
        updated: i.date,
      })),
    }));

    return {
      sport,
      league: mapping.league,
      teams_count: result.length,
      teams: result,
    };
  }

  /**
   * Get standings for a sport
   */
  async getStandings(sport, conference = null) {
    const mapping = SPORT_MAPPINGS[sport?.toLowerCase()];
    if (!mapping) {
      throw new Error(`Unsupported sport: ${sport}`);
    }

    const url = `https://site.web.api.espn.com/apis/v2/sports/${mapping.sport}/${mapping.league}/standings`;
    console.log(`📊 [ESPN] Fetching standings: ${url}`);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)' },
    });

    if (!response.ok) {
      throw new Error(`ESPN standings API error: ${response.status}`);
    }

    const data = await response.json();
    let conferences = data.children || [];

    // Filter by conference if specified
    if (conference) {
      const confLower = conference.toLowerCase();
      conferences = conferences.filter(c =>
        c.name?.toLowerCase().includes(confLower) ||
        c.abbreviation?.toLowerCase() === confLower
      );
    }

    // Parse standings and sort by rank
    const result = conferences.map(conf => {
      const standings = (conf.standings?.entries || []).map(entry => {
        const stats = entry.stats || [];
        const getStat = (name) => stats.find(s => s.name === name)?.value;

        return {
          rank: getStat('playoffSeed') || getStat('rank'),
          team: entry.team?.displayName,
          team_abbr: entry.team?.abbreviation,
          wins: getStat('wins'),
          losses: getStat('losses'),
          pct: getStat('winPercent'),
          games_back: getStat('gamesBehind'),
          streak: getStat('streak'),
          last_10: getStat('lastTenGames'),
        };
      });

      // Sort by rank ascending (1st place first)
      standings.sort((a, b) => (a.rank || 99) - (b.rank || 99));

      return {
        conference: conf.name,
        abbreviation: conf.abbreviation,
        standings,
      };
    });

    return {
      sport,
      league: mapping.league,
      conferences: result,
    };
  }

  /**
   * Get sports news
   */
  async getNews(sport, team = null, limit = 5) {
    const mapping = SPORT_MAPPINGS[sport?.toLowerCase()];
    if (!mapping) {
      throw new Error(`Unsupported sport: ${sport}`);
    }

    let url = `${BASE_URL}/${mapping.sport}/${mapping.league}/news?limit=${limit}`;
    // Note: team filtering would need team ID, keeping simple for now
    console.log(`📰 [ESPN] Fetching news: ${url}`);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveDataService/1.0)' },
    });

    if (!response.ok) {
      throw new Error(`ESPN news API error: ${response.status}`);
    }

    const data = await response.json();
    const articles = data.articles || [];

    return {
      sport,
      league: mapping.league,
      articles: articles.slice(0, limit).map(a => ({
        headline: a.headline,
        description: a.description,
        published: a.published,
        type: a.type,
        link: a.links?.web?.href,
      })),
    };
  }
}

export default ESPNProvider;
