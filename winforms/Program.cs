using System;
using System.Windows.Forms;

namespace HeartRateMonitor // Lưu ý namespace ở đây phải giống Form1
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Khởi động Form1
            Application.Run(new Form1());
        }
    }
}