const addCompetition = require('../../lib/add-competition');
const addMatch = require('../../lib/add-match');
const addPlayers = require('../../lib/add-players');
const deleteCompetition = require('../../lib/delete-competition');
const deletePlayer = require('../../lib/delete-player');
const getCompetitions = require('../../lib/get-competitions');
const getGroups = require('../../lib/get-groups');
const getMatches = require('../../lib/get-matches');
const getPlayers = require('../../lib/get-players');
const getRanking = require('../../lib/get-ranking');
const joinCompetition = require('../../lib/join-competition');
const updateActiveCompetition = require('../../lib/update-active-competition');
const updateProfile = require('../../lib/update-profile');
const userState = require('../../lib/user-state');

module.exports = (req, res) => {
  const actionParam = req.query?.action;
  const action = Array.isArray(actionParam) ? actionParam[0] : actionParam;

  switch (action) {
    case 'add-competition':
      return addCompetition(req, res);
    case 'add-match':
      return addMatch(req, res);
    case 'add-players':
      return addPlayers(req, res);
    case 'delete-competition':
      return deleteCompetition(req, res);
    case 'delete-player':
      return deletePlayer(req, res);
    case 'get-competitions':
      return getCompetitions(req, res);
    case 'get-groups':
      return getGroups(req, res);
    case 'get-matches':
      return getMatches(req, res);
    case 'get-players':
      return getPlayers(req, res);
    case 'get-ranking':
      return getRanking(req, res);
    case 'join-competition':
      return joinCompetition(req, res);
    case 'update-active-competition':
      return updateActiveCompetition(req, res);
    case 'update-profile':
      return updateProfile(req, res);
    case 'user-state':
      return userState(req, res);
    case undefined:
      return res.status(400).json({ error: 'Missing action parameter' });
    default:
      return res.status(404).json({ error: `Action "${action}" not found` });
  }
};
