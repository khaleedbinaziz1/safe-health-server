const express = require('express');
const cors = require('cors');
const { MongoClient} = require('mongodb');
const { ObjectId } = require('mongodb');
const multer = require('multer');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const port = process.env.PORT || 500;

const app = express();

//middleware
app.use(cors());
app.use(express.json());

// configure multer for uploading files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ujcbv.mongodb.net/?retryWrites=true&w=majority`;

console.log(uri);

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

function verifyJWT(req, res, next) {

  const authHeader = req.headers.authorization;
  if (!authHeader) {
      return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
      if (err) {
          return res.status(403).send({ message: 'forbidden access' })
      }
      req.decoded = decoded;
      next();
  })

}


async function run() {
  try {
    const appointmentOptionCollection = client.db('safeHealth').collection('appointmentOptions');
    const bookingsCollection = client.db('safeHealth').collection('bookings');
    const usersCollection = client.db('safeHealth').collection('users');

    app.get('/appointmentOptions', async (req, res) => {
      const searchTerm = req.query.q;
      const query = searchTerm ? { name: new RegExp(searchTerm, 'i') } : {};
      const options = await appointmentOptionCollection.find(query).toArray();
      const date = req.query.date;
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

      options.forEach(options => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === options.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = options.slots.filter(slot => !bookedSlots.includes(slot));
        options.slots = remainingSlots;
      });
      res.send(options);
    });

    app.get('/appointmentList', async (req, res) => {
      const bookings = await bookingsCollection.find().toArray();
      res.send(bookings);
    });
    app.get('/bookings',verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if(email !== decodedEmail){
        return res.status(403).send({message: 'Access Denied '});
      }
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);

    })

    // Use the upload middleware to handle files in the request
    app.post('/appointmentOptions', upload.single('image'), async (req, res) => {
      const { name, description, slots } = req.body;
      const appointmentOption = {
        name,
        description,
        slots: JSON.parse(slots),
        imageUrl: req.file.path
      };
      const result = await appointmentOptionCollection.insertOne(appointmentOption);
      res.send(result);
    });

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      };
      const bookingCounts = await bookingsCollection.find(query).toArray();
      if (bookingCounts.length) {
        const message = `you already have an appointment on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    }
    );

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({email}, process.env.ACCESS_TOKEN,{ expiresIn:'1h' })
        return res.send({ accessToken: token });
      }
      res.status(403).send({ accessToken: '' })
    })


    app.get('/users', async (req, res) => {
      const query = {};
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    })


    app.post('/users', async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    app.get('/users/admin/:email',async (req, res)=>{
      const email =req.params.email;
      const query = {email};
      const user = await usersCollection.findOne(query);
      res.send({isAdmin: user?.role === 'admin' });
    })

    app.put('/users/admin/:id',verifyJWT, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail};
      const user =await usersCollection.findOne(query);
      if(user?.role !=='admin'){
        return res.status(403).send({ message: 'Access denied'});
      }
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }; // Add 'new' keyword here
      const updateDoc = { $set: { role: 'admin' } };
      const options = { upsert: true };
    
      try {
        const result = await usersCollection.updateOne(filter, updateDoc, options);
        res.send(result);
        console.log(result)
      } catch (error) {
        console.error('Failed to update user role:', error);
        res.status(500).send('Failed to update user role');
      }
    });


  } finally {
  }
}

run().catch(console.log);

app.get('/', async (req, res) => {
  res.send('doctors server is running');
});

app.listen(port, () => console.log(`listening on port ${port}`));
