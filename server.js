const app = require('./app');
const { connect } = require('./Server/db/mongoose');

const PORT = process.env.PORT || 3000;

connect(); 

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
