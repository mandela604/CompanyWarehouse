const app = require('./app');
const { connect } = require('./Server/db/mongoose');

const PORT = process.env.PORT || 3000;

connect(); 

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});