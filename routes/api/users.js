const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const keys = require('../../config/keys');
const deafult = require('../../config/default');
// To send Email
const nodemailer = require('nodemailer');
// Load input validation
const validateRegisterInput = require('../../validation/register');
const validateLoginInput = require('../../validation/login');
// Load User model
const User = require('../../models/User');
const PersonalDetails = require('../../models/PersonalDetails');

const htmlForConfirmation = require('../../emails/confirmation');
const { addNotification } = require('../../functions/notifications');

var sendEmailVerification = function (newUser) {
  //Generate Token For email verification
  const tokenG = {
    user: {
      id: newUser.id,
    },
  };

  console.log(
    'Name: ' +
      newUser.first_name +
      ' => sending email to:' +
      newUser.email +
      ' => id: ' +
      newUser.id
  );
  jwt.sign(
    tokenG,
    keys.jwtSecret,
    {
      expiresIn: 3600, // 1 hour
    },
    (err, token) => {
      if (err) throw err;
      var transporter = nodemailer.createTransport({
        service: 'gmail',
        tls: {
          rejectUnauthorized: false,
        },
        auth: {
          type: 'OAuth2',
          user: process.env.EMAIL_ADDRESS,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
          accessToken: process.env.GMAIL_ACCESS_TOKEN,
        },
      });

      var mailOptions = {
        from: keys.taskBarterGmail,
        to: newUser.email,
        subject: 'Taskbarter | Verify Your Email',
        text:
          'Verify your email address by clicking on this link: https://www.taskbarter.com/confirmation/' +
          token,
        html: htmlForConfirmation(
          newUser.first_name,
          newUser.second_name,
          newUser.email,
          'https://www.taskbarter.com/confirmation/' + token
        ),
      };

      transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ');
        }
      });
    }
  );
};

// @route POST api/users/register
// @desc Register user
// @access Public
router.post('/register', (req, res) => {
  // Form validation
  const { errors, isValid } = validateRegisterInput(req.body);
  // Check validation
  if (!isValid) {
    return res.status(400).json(errors);
  }
  User.findOne({ email: req.body.email }).then((user) => {
    if (user) {
      return res.status(400).json({ email: 'Email already exists' });
    }
    User.findOne({ name: req.body.name }).then((user) => {
      if (user) {
        return res.status(400).json({ email: 'Username already exists' });
      } else {
        const newUser = {
          name: req.body.name,
          email: req.body.email,
          password: req.body.password,
        };
        const userPersonalDetails = {
          first_name: req.body.fname,
          second_name: req.body.sname,
        };
        createProfileAuth(newUser, userPersonalDetails)
          .then((user) => {
            sendEmailVerification({
              ...newUser,
              ...userPersonalDetails,
              id: user._id,
            });

            addNotification(
              `Welcome to Taskbarter! We suggest that you complete your profile before applying to jobs.`,
              user._id,
              `/me`
            );

            addNotification(
              `Congrats you just got 15 points as a welcome bonus`,
              user._id,
              `/`
            );

            return res.json(user);
          })
          .catch((err) => {
            console.log(err);
            return res.status(500).json({ errMsg: 'Server did not respond.' });
          });
      }
    });
  });
});

const createProfileAuth = async function (auth, profile) {
  try {
    const encrypted_pass = await hashPassword(auth.password);
    auth = { ...auth, password: encrypted_pass };
    const userEntry = await new User(auth).save();
    profile = { ...profile, user: userEntry._id };
    const profileEntry = await new PersonalDetails(profile).save();
    return new Promise((resolve, reject) => {
      if (userEntry) {
        resolve(userEntry);
      }
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({ email: 'Some error has occured!' });
  }
};

async function hashPassword(pass) {
  const password = pass;
  const saltRounds = 10;

  const hashedPassword = await new Promise((resolve, reject) => {
    bcrypt.hash(password, saltRounds, function (err, hash) {
      if (err) reject(err);
      resolve(hash);
    });
  });

  return hashedPassword;
}

// @route POST api/users/login
// @desc Login user and return JWT token
// @access Public
router.post('/login', (req, res) => {
  // Form validation
  const { errors, isValid } = validateLoginInput(req.body);
  // Check validation
  if (!isValid) {
    return res.status(400).json(errors);
  }

  const password = req.body.password;
  const name = req.body.email;

  checkUserForLogin({ name, password })
    .then((user) => {
      // Create JWT Payload
      const payload = {
        id: user.id,
        name: user.name,
        email: user.email,
      };
      // Sign token
      jwt.sign(
        payload,
        keys.secretOrKey,
        {
          expiresIn: 31556926, // 1 year in seconds
        },
        (err, token) => {
          res.json({
            success: true,
            token: 'Bearer ' + token,
          });
        }
      );
    })
    .catch((err) => {
      console.log(err);
      return res.status(404).json(err);
    });
});

const checkUserForLogin = async function (user_data) {
  try {
    const user = await User.findOne({
      $or: [{ email: user_data.name }, { name: user_data.name }],
    });

    if (!user) {
      if (!user && user_data.name.includes('@'))
        return Promise.reject({
          emailnotfound: 'Email not found',
          message: 'Email not found.',
        });
      else
        return Promise.reject({
          usernamenotfound: 'Username not found',
          message: 'Username not found.',
        });
    }

    const isPassCorrect = await bcrypt.compare(
      user_data.password,
      user.password
    );
    if (!isPassCorrect) {
      return Promise.reject({
        passwordincorrect: 'Incorrect password',
        message: 'Password you entered is incorrect.',
      });
    }

    if (!user.isEmailVerified) {
      const details = await PersonalDetails.findOne({ user: user._id });
      sendEmailVerification({
        email: user.email,
        first_name: details.first_name,
        second_name: details.second_name,
        id: user._id,
      });
      return Promise.reject({
        emailnotverified:
          'Please verify your email address to login. <br/>Verification email sent to ' +
          user.email,
        message: 'Your email is not yet verified.',
      });
    }
    return Promise.resolve(user);
  } catch (err) {
    console.log(err);
    return Promise.reject(err);
  }
};

//User Personal Details
router.post('/userpersonaldetails', (req, res) => {
  // Form validation
  const { errors, isValid } = validateLoginInput(req.body);
  // Check validation
  if (!isValid) {
    return res.status(400).json(errors);
  }
  const userpersonaldetails = new PersonalDetails({
    FName: req.body.FName,
    Lname: req.body.LName,
    address: req.body.address,
    headline: req.body.headline,
    DobDay: req.body.DobDay,
    DobMonth: req.body.DobMonth,
    DobYear: req.body.DobYear,
    PhoneNo: req.body.PhoneNo,
    gender: req.body.gender,
  });

  userpersonaldetails
    .save()
    .then(console.log('User details inserted'))
    .catch((err) => console.log(err));
});

module.exports = router;
