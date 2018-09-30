var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var mysql = require('mysql');
var moment = require('moment');
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

var connection = mysql.createConnection({
  multipleStatements: true,
  host     : '127.0.0.1',
  user     : 'root',
  password : 'root',
  database : 'app'
});

app.get('/', function(req, res){
  connection.query('select * from elections;', function (error, results, fields) {
    if (error) throw error;
    console.log(results);
    data = {
      moment: moment,
      items: results
    }
    res.render('index.ejs',data);
  });
});

app.get('/election/:id', function(req, res){
  id = req.params.id;
  connection.query('select * from elections where id = ' + id + ';SELECT s.*, CASE WHEN count IS NULL THEN 0 ELSE count END AS voted FROM subjects s LEFT JOIN (SELECT subject_id, count(*) AS count FROM invoices WHERE election_id = ' + id +'  GROUP BY subject_id) i ON s.id = i.subject_id;', function (error, results, fields) {
    if (error) throw error;
    console.log(results);
    data = {
      election: results[0][0],
      subjects: results[1],
    }
    res.send(data);
  });
});

io.on('connection', function(socket){
  console.log('a user connected');
  socket.broadcast.emit('new user', 'ユーザーが入室しました');

  var loginUsers = []; //ログインユーザ

  // ログイン処理
  socket.on('login', function(userInfo){
    loginUsers[userInfo.userID] = userInfo.userName;
    console.log(userInfo.userID+' : '+userInfo.userName + 'がログインしました')
  });

  socket.on('chat message', function(msg){
    console.log(socket.id);
    userName = loginUsers[socket.id];
    io.emit('chat message', {
        userName: userName,
        message: msg
      });
    console.log(userName + ' said: ' + msg);
  });

  socket.on('disconnect', function(){
    console.log('user disconnected');
  });
});


http.listen(3000, function(){
  console.log('listening on *:3000');
});
