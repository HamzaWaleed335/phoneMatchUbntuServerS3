import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import flash from 'connect-flash';
import methodOverride from 'method-override';
import passport from 'passport';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { ensureDirs } from './services/store.js';
import engine from 'ejs-mate';


import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import clientRoutes from './routes/client.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


ensureDirs('uploads');


const app = express();
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));


app.use(session({
secret: process.env.SESSION_SECRET || 'supersecret',
resave: false,
saveUninitialized: false,
cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());


app.use((req, res, next) => {
res.locals.user = req.user;
res.locals.message = req.flash('info');
res.locals.error = req.flash('error');
next();
});


app.use('/', authRoutes);
app.get('/', (req, res) => res.render('index'));
app.use('/admin', adminRoutes);
app.use('/client', clientRoutes);


app.use((err, req, res, next) => {
console.error(err);
res.status(500).send('Something went wrong');
});


const port = process.env.PORT || 8070;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
