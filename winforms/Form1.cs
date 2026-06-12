using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Globalization;
using System.IO.Ports;
using System.Text;
using System.Windows.Forms;
using LiveCharts;
using LiveCharts.WinForms;
using LiveCharts.Wpf;
using LiveCharts.Defaults;

namespace HeartRateMonitor
{
    public partial class Form1 : Form
    {
        // ==========================================
        // 1. KHAI BÁO BIẾN GIAO DIỆN
        // ==========================================
        private Panel panelHeader;
        private PictureBox picLogo;
        private Label lblTitle;
        private Label lblUniversity;
        private Panel panelInfo;
        private ComboBox cmbPorts;
        private Button btnConnect;
        private Button btnDisconnect;
        private Label lblStatus;
        private Label lblHeartRate;
        private Label lblSp02;
        private Label label1;
        private Label label2;
        private Panel panelChart;

        // DÙNG LẠI LIVECHARTS ĐỂ CÓ GIAO DIỆN ĐẸP NHƯ CŨ
        private LiveCharts.WinForms.CartesianChart chartPPG;
        private ChartValues<ObservablePoint> voltageValues;

        // ==========================================
        // 2. BIẾN HỆ THỐNG & ĐA LUỒNG
        // ==========================================
        private SerialPort serialPort;
        private readonly StringBuilder rxBuffer = new StringBuilder();
        private readonly ConcurrentQueue<string> lineQueue = new ConcurrentQueue<string>();
        private Timer uiTimer;

        private const int WINDOW_SIZE = 250;
        private double startTimeSec = -1;

        // Bộ lọc ảo (Chỉ dùng để tạo hiệu ứng chữ nháy đỏ, không làm méo sóng hiển thị)
        private const double HP_ALPHA = 0.96;
        private const double LP_ALPHA = 0.25;
        private double hp_prevInput = 0, hp_prevOutput = 0, lp_prevOutput = 0;
        private double prevSignal = 0;

        public Form1()
        {
            SetupMainForm();
            BuildUI();
            InitializeCharts();
            LoadComPorts();

            // Timer quét dữ liệu siêu mượt (Chống giật lag UI)
            uiTimer = new Timer { Interval = 40 };
            uiTimer.Tick += UiTimer_Tick;
            uiTimer.Start();

            btnConnect.Click += btnConnect_Click;
            btnDisconnect.Click += btnDisconnect_Click;
            this.FormClosing += Form1_FormClosing;
            this.Resize += Form1_Resize;
            this.Load += Form1_Load;
        }

        private void Form1_Load(object sender, EventArgs e)
        {
            try
            {
                // Tải logo UTC
                picLogo.Image = Image.FromFile("utc-logo.png");
            }
            catch { }
            Form1_Resize(this, EventArgs.Empty);
        }

        // =========================================================
        // GIAO DIỆN (UI) - ĐƯỢC GIỮ NGUYÊN BỐ CỤC ĐẸP
        // =========================================================
        private void SetupMainForm()
        {
            this.Text = "HE TONG GIAM SAT SUC KHOE - UTC";
            this.ClientSize = new Size(1100, 700);
            this.BackColor = Color.White;
            this.StartPosition = FormStartPosition.CenterScreen;
        }

        private void BuildUI()
        {
            panelChart = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(10) };
            this.Controls.Add(panelChart);
            panelInfo = new Panel { Dock = DockStyle.Top, Height = 130, BackColor = Color.WhiteSmoke, BorderStyle = BorderStyle.FixedSingle };
            this.Controls.Add(panelInfo);
            panelHeader = new Panel { Dock = DockStyle.Top, Height = 100, BackColor = Color.FromArgb(0, 51, 102) };
            this.Controls.Add(panelHeader);

            picLogo = new PictureBox { Location = new Point(10, 10), Size = new Size(80, 80), BackColor = Color.Transparent, SizeMode = PictureBoxSizeMode.Zoom };
            panelHeader.Controls.Add(picLogo);
            lblTitle = new Label { Text = "HỆ THỐNG GIÁM SÁT SỨC KHỎE", Font = new Font("Segoe UI", 20, FontStyle.Bold), ForeColor = Color.White, AutoSize = true };
            panelHeader.Controls.Add(lblTitle);
            lblUniversity = new Label { Text = "TRƯỜNG ĐẠI HỌC GIAO THÔNG VẬN TẢI", Font = new Font("Segoe UI", 12, FontStyle.Bold), ForeColor = Color.Gold, AutoSize = true };
            panelHeader.Controls.Add(lblUniversity);

            int centerY = 50;
            cmbPorts = new ComboBox { Location = new Point(20, centerY), Width = 100, Font = new Font("Segoe UI", 12), DropDownStyle = ComboBoxStyle.DropDownList };
            panelInfo.Controls.Add(cmbPorts);
            btnConnect = new Button { Text = "KẾT NỐI", BackColor = Color.ForestGreen, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Size = new Size(90, 32), Location = new Point(135, centerY - 2) };
            panelInfo.Controls.Add(btnConnect);
            btnDisconnect = new Button { Text = "NGẮT", BackColor = Color.Crimson, ForeColor = Color.White, FlatStyle = FlatStyle.Flat, Size = new Size(90, 32), Location = new Point(235, centerY - 2), Enabled = false };
            panelInfo.Controls.Add(btnDisconnect);
            lblStatus = new Label { Text = "Trạng thái: Chưa kết nối", Font = new Font("Segoe UI", 12, FontStyle.Italic), ForeColor = Color.DimGray, AutoSize = false, Location = new Point(340, centerY - 8), Size = new Size(350, 60), TextAlign = ContentAlignment.MiddleLeft };
            panelInfo.Controls.Add(lblStatus);

            label1 = new Label { Text = "NHỊP TIM (BPM)", AutoSize = false, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Color.Crimson, TextAlign = ContentAlignment.MiddleCenter, Size = new Size(250, 40), Anchor = AnchorStyles.Top | AnchorStyles.Right };
            lblHeartRate = new Label { Text = "--", AutoSize = false, Font = new Font("Segoe UI", 25, FontStyle.Bold), ForeColor = Color.Crimson, TextAlign = ContentAlignment.MiddleCenter, Size = new Size(250, 75), Anchor = AnchorStyles.Top | AnchorStyles.Right };

            label2 = new Label { Text = "SPO2 (%)", AutoSize = false, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Color.DodgerBlue, TextAlign = ContentAlignment.MiddleCenter, Size = new Size(160, 40), Anchor = AnchorStyles.Top | AnchorStyles.Right };
            lblSp02 = new Label { Text = "--", AutoSize = false, Font = new Font("Segoe UI", 25, FontStyle.Bold), ForeColor = Color.DodgerBlue, TextAlign = ContentAlignment.MiddleCenter, Size = new Size(160, 75), Anchor = AnchorStyles.Top | AnchorStyles.Right };

            panelInfo.Controls.AddRange(new Control[] { label1, lblHeartRate, label2, lblSp02 });
            LayoutIndicators();
        }

        private void LayoutIndicators()
        {
            if (panelInfo == null || label1 == null) return;
            int rightMargin = 20; int spacing = 30;
            int bpmWidth = 250; int spo2Width = 160;
            int spo2X = panelInfo.Width - rightMargin - spo2Width;
            int bpmX = spo2X - spacing - bpmWidth;
            int titleY = 10; int valueY = 45;

            label2.Location = new Point(spo2X, titleY); lblSp02.Location = new Point(spo2X, valueY);
            label1.Location = new Point(bpmX, titleY); lblHeartRate.Location = new Point(bpmX, valueY);
        }

        private void Form1_Resize(object sender, EventArgs e)
        {
            if (lblTitle != null && panelHeader != null)
            {
                int contentWidth = picLogo.Width + 15 + lblTitle.Width;
                int startX = Math.Max(10, (panelHeader.Width - contentWidth) / 2);
                picLogo.Location = new Point(startX, (panelHeader.Height - picLogo.Height) / 2);
                int textX = startX + picLogo.Width + 15;
                lblTitle.Location = new Point(textX, 12);
                int uniX = Math.Max(textX, textX + (lblTitle.Width - lblUniversity.Width) / 2);
                lblUniversity.Location = new Point(uniX, 60);
            }
            if (chartPPG != null && panelChart != null)
            {
                chartPPG.Size = new Size(panelChart.Width - 20, panelChart.Height - 20);
                chartPPG.Location = new Point(10, 10);
            }
            LayoutIndicators();
        }

        // =========================================================
        // KHỞI TẠO BIỂU ĐỒ LIVECHARTS (Chuẩn như ảnh cũ)
        // =========================================================
        private void InitializeCharts()
        {
            voltageValues = new ChartValues<ObservablePoint>();
            chartPPG = new LiveCharts.WinForms.CartesianChart
            {
                Dock = DockStyle.None,
                DisableAnimations = true,
                Hoverable = false,
                DataTooltip = null,
                BackColor = Color.White
            };

            chartPPG.Series = new SeriesCollection {
                new LineSeries {
                    Title = "V_analog",
                    Values = voltageValues,
                    PointGeometry = null,
                    LineSmoothness = 0, // Đường nét dứt khoát như ảnh ESP32
                    StrokeThickness = 2,
                    Stroke = System.Windows.Media.Brushes.Red,
                    Fill = System.Windows.Media.Brushes.Transparent
                }
            };

            // Trục Y hiển thị chuẩn 3 số thập phân (F3) và tự động co giãn
            chartPPG.AxisY.Add(new Axis
            {
                Title = "V_analog (V)",
                MinValue = double.NaN,
                MaxValue = double.NaN,
                Foreground = System.Windows.Media.Brushes.Black,
                LabelFormatter = value => value.ToString("F3"),
                Separator = new Separator { IsEnabled = true, Stroke = System.Windows.Media.Brushes.LightGray, Step = double.NaN }
            });

            // Trục X có lưới kẻ
            chartPPG.AxisX.Add(new Axis
            {
                Title = "Thời gian (s)",
                ShowLabels = true,
                Foreground = System.Windows.Media.Brushes.Black,
                Separator = new Separator { IsEnabled = true, Stroke = System.Windows.Media.Brushes.LightGray, Step = double.NaN }
            });

            panelChart.Controls.Add(chartPPG);
        }

        // =========================================================
        // ĐỌC DỮ LIỆU ĐA LUỒNG TỪ SERIAL (Chống đơ UI)
        // =========================================================
        private void SerialPort_DataReceived(object sender, SerialDataReceivedEventArgs e)
        {
            try
            {
                string s = serialPort.ReadExisting();
                if (string.IsNullOrEmpty(s)) return;

                lock (rxBuffer)
                {
                    rxBuffer.Append(s);
                    string fullStr = rxBuffer.ToString();
                    int nl;
                    while ((nl = fullStr.IndexOf('\n')) >= 0)
                    {
                        string line = fullStr.Substring(0, nl + 1).Trim();
                        if (!string.IsNullOrWhiteSpace(line)) lineQueue.Enqueue(line);
                        fullStr = fullStr.Substring(nl + 1);
                    }
                    rxBuffer.Clear();
                    rxBuffer.Append(fullStr);
                }
            }
            catch { }
        }

        // Timer xử lý dữ liệu liên tục để vẽ đồ thị
        private void UiTimer_Tick(object sender, EventArgs e)
        {
            while (lineQueue.TryDequeue(out string line))
            {
                ProcessLine(line);
            }
        }

        private void ProcessLine(string line)
        {
            try
            {
                string[] parts = line.Split(',');

                // Chuẩn của ESP32: timeUs, irRaw, redRaw, Vt, finalBPM, finalSPO2
                if (parts.Length >= 6)
                {
                    long timeUs = 0, irRaw = 0;
                    double voltage = 0, espSPO2 = 0;
                    int espBPM = 0;

                    long.TryParse(parts[0], out timeUs);
                    long.TryParse(parts[1], out irRaw);
                    double.TryParse(parts[3], NumberStyles.Any, CultureInfo.InvariantCulture, out voltage);
                    int.TryParse(parts[4], out espBPM);
                    double.TryParse(parts[5], NumberStyles.Any, CultureInfo.InvariantCulture, out espSPO2);

                    double timeSec = timeUs / 1000000.0;
                    if (startTimeSec == -1) startTimeSec = timeSec;
                    double relativeTime = timeSec - startTimeSec;

                    // --- KIỂM TRA NGÓN TAY TRƯỚC ---
                    if (irRaw < 50000)
                    {
                        lblStatus.Text = "Vui lòng đặt ngón tay lên cảm biến...";
                        lblStatus.ForeColor = Color.Orange;
                        lblHeartRate.Text = "--";
                        lblSp02.Text = "--";

                        voltageValues.Clear();
                        hp_prevInput = 0; hp_prevOutput = 0; lp_prevOutput = 0;
                        startTimeSec = -1;
                        return;
                    }

                    lblStatus.Text = "Đang nhận dữ liệu từ ESP32...";
                    lblStatus.ForeColor = Color.ForestGreen;

                    // --- 1. VẼ TRỰC TIẾP SÓNG ĐIỆN ÁP THÔ (Vt) ---
                    voltageValues.Add(new ObservablePoint(relativeTime, voltage));
                    if (voltageValues.Count > WINDOW_SIZE) voltageValues.RemoveAt(0);

                    // --- 2. BỘ LỌC ẢO TẠO HIỆU ỨNG NHÁY ĐỎ BÁO TIM ĐẬP ---
                    double hpOutput = HP_ALPHA * (hp_prevOutput + voltage - hp_prevInput);
                    hp_prevInput = voltage;
                    hp_prevOutput = hpOutput;

                    double filteredSignal = LP_ALPHA * hpOutput + (1.0 - LP_ALPHA) * lp_prevOutput;
                    if (Math.Abs(filteredSignal) < 0.000001) filteredSignal = 0;
                    lp_prevOutput = filteredSignal;

                    bool isVisualPeak = (filteredSignal > 0 && prevSignal <= 0);
                    prevSignal = filteredSignal;

                    // --- 3. ĐỒNG BỘ HIỂN THỊ CHỈ SỐ ---
                    if (espBPM > 40 && espBPM < 200) lblHeartRate.Text = espBPM.ToString();
                    else lblHeartRate.Text = "--";

                    // [ĐÃ SỬA] Hiển thị 1 số thập phân (0.0) giống giao diện Web
                    if (espSPO2 > 0 && espSPO2 <= 100) lblSp02.Text = espSPO2.ToString("0.0");
                    else lblSp02.Text = "--";

                    lblHeartRate.ForeColor = isVisualPeak ? Color.Red : Color.Crimson;
                }
            }
            catch { }
        }

        // =========================================================
        // KẾT NỐI COM PORT
        // =========================================================
        private void LoadComPorts()
        {
            cmbPorts.Items.Clear();
            string[] ports = SerialPort.GetPortNames();
            if (ports.Length > 0) { cmbPorts.Items.AddRange(ports); cmbPorts.SelectedIndex = 0; }
            else { cmbPorts.Items.Add("No COM"); cmbPorts.SelectedIndex = 0; btnConnect.Enabled = false; }
        }

        private void btnConnect_Click(object sender, EventArgs e)
        {
            try
            {
                if (cmbPorts.SelectedItem.ToString() == "No COM") return;
                serialPort = new SerialPort(cmbPorts.SelectedItem.ToString(), 115200);
                serialPort.DataReceived += SerialPort_DataReceived;
                serialPort.Open();
                btnConnect.Enabled = false; btnDisconnect.Enabled = true; cmbPorts.Enabled = false;

                voltageValues.Clear();
                hp_prevInput = 0; hp_prevOutput = 0; lp_prevOutput = 0;
                startTimeSec = -1;
            }
            catch (Exception ex) { MessageBox.Show("Lỗi: " + ex.Message); }
        }

        private void btnDisconnect_Click(object sender, EventArgs e)
        {
            try
            {
                if (serialPort != null && serialPort.IsOpen) serialPort.Close();
                btnConnect.Enabled = true; btnDisconnect.Enabled = false; cmbPorts.Enabled = true;
                lblStatus.Text = "Đã ngắt kết nối";
            }
            catch { }
        }

        private void Form1_FormClosing(object sender, FormClosingEventArgs e)
        {
            uiTimer?.Stop();
            if (serialPort != null && serialPort.IsOpen) serialPort.Close();
        }
    }
}