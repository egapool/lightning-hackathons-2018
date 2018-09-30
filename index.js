var grpc = require('grpc');
var QRCode = require('qrcode');
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var mysql = require('mysql');
var moment = require('moment');
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
var serveStatic = require('serve-static')
app.use(serveStatic(__dirname + '/public'))

var lnrpc = grpc.load('assets/rpc.proto').lnrpc;
var macaroon = "0201036c6e6402bb01030a10fedbc471d003d162a9873fc60be999ad1201301a160a0761646472657373120472656164120577726974651a130a04696e666f120472656164120577726974651a170a08696e766f69636573120472656164120577726974651a160a076d657373616765120472656164120577726974651a170a086f6666636861696e120472656164120577726974651a160a076f6e636861696e120472656164120577726974651a140a0570656572731204726561641205777269746500000620c3b3a92f749841136e3e5366b8846332551ee276a4c07a061a949639ebba8733";
var sslCreds = grpc.credentials.createSsl();

var macaroonCreds = grpc.credentials.createFromMetadataGenerator(function (args, callback) {
    var metadata = new grpc.Metadata()
    metadata.add('macaroon', macaroon);
    callback(null, metadata);
});


var creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);

var lightning = new lnrpc.Lightning("btcpaytest6.indiesquare.net:443", creds);

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
  connection.query('select * from elections where id = ' + id + ';SELECT s.*, CASE WHEN count IS NULL THEN 0 ELSE count END AS voted FROM subjects s LEFT JOIN (SELECT subject_id, count(*) AS count FROM invoices WHERE election_id = ' + id +' AND paid = 1 GROUP BY subject_id) i ON s.id = i.subject_id;', function (error, results, fields) {
    if (error) throw error;
    console.log(results);
    data = {
      election: results[0][0],
      subjects: results[1],
    }
    res.send(data);
  });
});


var loginUsers = []; //ログインユーザ
io.on('connection', function(socket){
  console.log('a user connected');
  socket.broadcast.emit('new user', 'ユーザーが入室しました');

  // ログイン処理
  socket.on('login', function(userInfo){
    loginUsers[userInfo.userID] = userInfo.userName;
    console.log(userInfo.userID+' : '+userInfo.userName + 'がログインしました')
    console.log(loginUsers)
  });

  socket.on('invoice', function(req){
    user_id = loginUsers[socket.id];

    // TODO invoice作成
    lightning.addInvoice({ value: 10 }, (err, response) => {
      if (err != undefined) {
          console.error("error:" + err);
      }
      invoice = response.payment_request;
      let opts = {
        errorCorrectionLevel: 'H',
        type: 'image/jpeg',
        rendererOpts: {
            quality: 0.3
        }
      }
      QRCode.toDataURL(invoice, opts)
        .then(url => {
            // console.log(url);
            invoice_qr = url;

            election_id = req.election_id;
            subject_id = req.subject_id;

            connection.query('INSERT INTO invoices (election_id,subject_id,user_id,invoice,paid,updated_at,created_at) VALUES (?,?,?,?,?,?,?)', [election_id,subject_id,user_id,invoice,0,moment().format("YYYY-MM-DD HH:mm:ss"),moment().format("YYYY-MM-DD HH:mm:ss")] ,function (error, results, fields) {
              if (error) throw error;
              console.log(results);
              io.to(socket.id).emit('invoice', {
                invoice: invoice,
                invoice_qr: invoice_qr
              })

              // 支払いを監視
              const hashByte = response.r_hash;
                console.log(hashByte);

                function toHexString(byteArray) {
                    return Array.prototype.map.call(byteArray, function (byte) {
                        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
                    }).join('');
                }

                const hexString = toHexString(hashByte);
                console.log('hex string: ' + hexString);

                var lookUp = function (hexString, hashByte,i, election_id) {
                    console.log('set interval begin'+ hexString);
                    lightning.lookupInvoice({
                        r_hash_str: hexString
                        // r_hash: hashByte
                    }, function (err, response2) {
                        if (err) console.log('error: ' + err);
                        if ( response2 !== undefined) {
                          console.log(response2);
                          if (response2.settled) {
                              console.log('Invoice is paid!!');
                              clearInterval(interval);
                              pay_req = response2.payment_request;
                              connection.query('UPDATE invoices SET paid = 1 where invoice = ?;',[pay_req], function (error, results, fields) {
                                if (error) throw error;
                                // TODO
                                connection.query('SELECT s.*, CASE WHEN count IS NULL THEN 0 ELSE count END AS voted FROM subjects s LEFT JOIN (SELECT subject_id, count(*) AS count FROM invoices WHERE election_id = ? AND paid = 1 GROUP BY subject_id) i ON s.id = i.subject_id;', [election_id], function (error, results, fields) {
                                  if (error) throw error;
                                  console.log(results);
                                  data = {
                                    subjects: results,
                                  }
                                  io.emit('update vote', data);
                                });
                              });

                          } else {
                              console.log('Invoice is still unpaid.');
                          }
                        }
                        
                    });
                    if (i > 600) {
                      clearInterval(interval);
                    }
                }

                var i = 0;
                var interval = setInterval(function () {
                  lookUp(hexString, hashByte,i,election_id)
                  i++;
                }, 1000);

              
            });
        })
        .catch(err => {
            console.error(err);
        });
      
      console.log(response);
    });

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
