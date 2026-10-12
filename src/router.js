'use strict';
// An express.Router whose route handlers may be async: rejected promises go to the error handler.
const express = require('express');

module.exports = function asyncRouter() {
  const router = express.Router();
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    const orig = router[m].bind(router);
    router[m] = (p, ...handlers) => orig(p, ...handlers.map(h => (req, res, next) => {
      try { return Promise.resolve(h(req, res, next)).catch(next); } catch (e) { return next(e); }
    }));
  }
  return router;
};
