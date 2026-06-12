using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Ports;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using System.Windows.Forms.DataVisualization.Charting;
using System.Drawing;

namespace PpgMonitor
{
 public class MainForm : Form
 {
 private const int MaxPoints =800;
 private SerialPort _serial;
 private readonly StringBuilder _rxBuffer = new StringBuilder();
 private readonly ConcurrentQueue<string> _lineQueue = new ConcurrentQueue<string>();
 private readonly Timer _uiTimer;
 private Chart _chart;
 private Series _series;
 private ComboBox _cmbPorts;
 private Button _btnRefresh;
 private Button _btnConnect;
 private Label _lblStatus;
 private Label _lblBpm;
 private Label _lblSpo2;

 public MainForm()
 {
 Text = "PPG Monitor - ESP32 Serial";
 Width =1200;
 Height =600;
 StartPosition = FormStartPosition.CenterScreen;

 InitializeComponent();

 _uiTimer = new Timer { Interval =40 };
 _uiTimer.Tick += UiTimer_Tick;
 _uiTimer.Start();

 RefreshComPorts();
 }

 private void InitializeComponent()
 {
 var topPanel = new Panel { Dock = DockStyle.Top, Height =72, Padding = new Padding(8) };
 Controls.Add(topPanel);

 _cmbPorts = new ComboBox { Left =8, Top =12, Width =160, DropDownStyle = ComboBoxStyle.DropDownList };
 topPanel.Controls.Add(_cmbPorts);

 _btnRefresh = new Button { Left =176, Top =10, Width =90, Text = "Refresh" };
 _btnRefresh.Click += (s, e) => RefreshComPorts();
 topPanel.Controls.Add(_btnRefresh);

 _btnConnect = new Button { Left =276, Top =10, Width =120, Text = "Connect" };
 _btnConnect.Click += BtnConnect_Click;
 topPanel.Controls.Add(_btnConnect);

 _lblStatus = new Label { Left =410, Top =14, AutoSize = true, Text = "Status: Disconnected", ForeColor = Color.DarkRed };
 topPanel.Controls.Add(_lblStatus);

 _lblBpm = new Label
 {
 AutoSize = false,
 TextAlign = ContentAlignment.MiddleCenter,
 Font = new Font("Segoe UI",28, FontStyle.Bold),
 ForeColor = Color.FromArgb(244,63,94),
 Width =180,
 Height =56,
 Left = ClientSize.Width -380,
 Top =8,
 Anchor = AnchorStyles.Top | AnchorStyles.Right,
 Text = "--"
 };
 topPanel.Controls.Add(_lblBpm);

 var lblBpmTitle = new Label
 {
 Text = "NH?P TIM (BPM)",
 Font = new Font("Segoe UI",9, FontStyle.Regular),
 AutoSize = true,
 ForeColor = Color.DimGray,
 Top =44,
 Left = _lblBpm.Left +6,
 Anchor = AnchorStyles.Top | AnchorStyles.Right
 };
 topPanel.Controls.Add(lblBpmTitle);

 _lblSpo2 = new Label
 {
 AutoSize = false,
 TextAlign = ContentAlignment.MiddleCenter,
 Font = new Font("Segoe UI",20, FontStyle.Bold),
 ForeColor = Color.FromArgb(0,180,216),
 Width =160,
 Height =44,
 Left = ClientSize.Width -190,
 Top =12,
 Anchor = AnchorStyles.Top | AnchorStyles.Right,
 Text = "--"
 };
 topPanel.Controls.Add(_lblSpo2);

 var lblSpo2Title = new Label
 {
 Text = "SpO? (%)",
 Font = new Font("Segoe UI",9, FontStyle.Regular),
 AutoSize = true,
 ForeColor = Color.DimGray,
 Top =44,
 Left = _lblSpo2.Left +18,
 Anchor = AnchorStyles.Top | AnchorStyles.Right
 };
 topPanel.Controls.Add(lblSpo2Title);

 _chart = new Chart { Dock = DockStyle.Fill, BackColor = Color.WhiteSmoke };
 Controls.Add(_chart);

 var area = new ChartArea("PPG")
 {
 BackColor = Color.White,
 AxisX =
 {
 MajorGrid = { LineColor = Color.FromArgb(230,230,230) },
 Enabled = AxisEnabled.False
 },
 AxisY =
 {
 MajorGrid = { LineColor = Color.FromArgb(230,230,230) },
 LabelStyle = { ForeColor = Color.DimGray },
 IsStartedFromZero = false
 }
 };
 _chart.ChartAreas.Add(area);

 _series = new Series("PPG")
 {
 ChartType = SeriesChartType.FastLine,
 Color = Color.FromArgb(255,77,109),
 BorderWidth =2,
 ChartArea = "PPG",
 ShadowOffset =0,
 IsVisibleInLegend = false
 };
 _chart.Series.Add(_series);

 for (int i =0; i < MaxPoints; i++) _series.Points.AddY(0.2);

 Resize += (s, e) =>
 {
 _lblBpm.Left = ClientSize.Width -380;
 _lblSpo2.Left = ClientSize.Width -190;
 };
 }

 private void RefreshComPorts()
 {
 var ports = SerialPort.GetPortNames().OrderBy(n => n).ToArray();
 _cmbPorts.Items.Clear();
 _cmbPorts.Items.AddRange(ports);
 if (_cmbPorts.Items.Count >0) _cmbPorts.SelectedIndex =0;
 _lblStatus.Text = ports.Length >0 ? "Ports found" : "No COM ports";
 _lblStatus.ForeColor = ports.Length >0 ? Color.DarkGreen : Color.DarkRed;
 }

 private void BtnConnect_Click(object sender, EventArgs e)
 {
 if (_serial == null || !_serial.IsOpen)
 {
 if (_cmbPorts.SelectedItem == null)
 {
 MessageBox.Show("Ch?n c?ng COM tr??c.", "Thông báo", MessageBoxButtons.OK, MessageBoxIcon.Warning);
 return;
 }
 try
 {
 var portName = _cmbPorts.SelectedItem.ToString();
 _serial = new SerialPort(portName,115200, Parity.None,8, StopBits.One)
 {
 ReadTimeout =500,
 NewLine = "\n",
 Encoding = Encoding.ASCII
 };
 _serial.DataReceived += Serial_DataReceived;
 _serial.Open();
 _btnConnect.Text = "Disconnect";
 _lblStatus.Text = $"Connected {portName}";
 _lblStatus.ForeColor = Color.DarkGreen;
 _cmbPorts.Enabled = false;
 _btnRefresh.Enabled = false;
 }
 catch (Exception ex)
 {
 MessageBox.Show("Không th? m? COM: " + ex.Message, "L?i", MessageBoxButtons.OK, MessageBoxIcon.Error);
 }
 }
 else
 {
 DisconnectSerial();
 }
 }

 private void DisconnectSerial()
 {
 try
 {
 if (_serial != null)
 {
 _serial.DataReceived -= Serial_DataReceived;
 if (_serial.IsOpen) _serial.Close();
 _serial.Dispose();
 _serial = null;
 }
 }
 catch { }
 _btnConnect.Text = "Connect";
 _lblStatus.Text = "Disconnected";
 _lblStatus.ForeColor = Color.DarkRed;
 _cmbPorts.Enabled = true;
 _btnRefresh.Enabled = true;
 }

 private void Serial_DataReceived(object sender, SerialDataReceivedEventArgs e)
 {
 try
 {
 var s = _serial.ReadExisting();
 if (string.IsNullOrEmpty(s)) return;
 lock (_rxBuffer)
 {
 _rxBuffer.Append(s);
 string full = _rxBuffer.ToString();
 int nl;
 while ((nl = full.IndexOf('\n')) >=0)
 {
 string line = full.Substring(0, nl +1).Trim();
 if (!string.IsNullOrWhiteSpace(line))
 _lineQueue.Enqueue(line);
 full = full.Substring(nl +1);
 }
 _rxBuffer.Clear();
 _rxBuffer.Append(full);
 }
 }
 catch { }
 }

 private void UiTimer_Tick(object sender, EventArgs e)
 {
 bool updated = false;
 while (_lineQueue.TryDequeue(out var line))
 {
 ProcessLine(line);
 updated = true;
 }

 if (updated)
 {
 while (_series.Points.Count > MaxPoints) _series.Points.RemoveAt(0);

 if (_series.Points.Count >5)
 {
 double min = _series.Points.Min(p => p.YValues[0]);
 double max = _series.Points.Max(p => p.YValues[0]);
 if (min == max) { min -=0.5; max +=0.5; }
 double pad = Math.Max(0.05, (max - min) *0.12);
 var area = _chart.ChartAreas[0];
 area.AxisY.Minimum = Math.Max(0, min - pad);
 area.AxisY.Maximum = max + pad;
 }
 _chart.Invalidate();
 }
 }

 private void ProcessLine(string line)
 {
 var parts = line.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
 if (parts.Length <6) return;

 bool parsedVt = double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double vt);
 if (!parsedVt)
 {
 if (double.TryParse(parts[1].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double irRaw))
 {
 vt = (irRaw /262143.0) *3.3;
 }
 else vt =0.2;
 }

 if (double.TryParse(parts[4].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double bpm))
 {
 _lblBpm.Text = bpm >0 ? $"{bpm:F0}" : "--";
 }
 if (double.TryParse(parts[5].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double spo2))
 {
 _lblSpo2.Text = spo2 >0 ? $"{spo2:F1} %" : "--";
 }

 if (double.IsNaN(vt) || double.IsInfinity(vt)) vt =0.2;
 _series.Points.AddY(vt);
 if (_series.Points.Count > MaxPoints) _series.Points.RemoveAt(0);
 }

 protected override void OnFormClosing(FormClosingEventArgs e)
 {
 base.OnFormClosing(e);
 _uiTimer?.Stop();
 DisconnectSerial();
 }
 }
}
