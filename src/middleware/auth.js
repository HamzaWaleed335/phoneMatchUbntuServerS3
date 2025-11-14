export function ensureAuth(req, res, next) {
if (req.isAuthenticated && req.isAuthenticated()) return next();
res.redirect('/login');
}


export function ensureRole(role) {
return (req, res, next) => {
if (req.isAuthenticated && req.isAuthenticated() && req.user.role === role) return next();
res.status(403).send('Forbidden');
};
}