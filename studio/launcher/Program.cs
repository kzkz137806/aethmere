using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Aethmere Agent Studio")]
[assembly: AssemblyDescription("Aethmere Agent Studio public Windows preview")]
[assembly: AssemblyCompany("Aethmere")]
[assembly: AssemblyProduct("Aethmere Agent Studio")]
[assembly: AssemblyCopyright("Copyright Aethmere")]
[assembly: AssemblyVersion("0.10.1.0")]
[assembly: AssemblyFileVersion("0.10.1.0")]

namespace Aethmere.AgentStudioLauncher
{
    internal static class Program
    {
        private static string Quote(string value)
        {
            if (String.IsNullOrEmpty(value)) return "\"\"";
            if (value.IndexOfAny(new[] { ' ', '\t', '\"' }) < 0) return value;
            var result = new StringBuilder("\"");
            var backslashes = 0;
            foreach (var character in value)
            {
                if (character == '\\')
                {
                    backslashes += 1;
                    continue;
                }
                if (character == '\"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('\"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(character);
            }
            result.Append('\\', backslashes * 2);
            result.Append('\"');
            return result.ToString();
        }

        [STAThread]
        private static void Main(string[] args)
        {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            var runtime = Path.Combine(root, "runtime");
            var electron = Path.Combine(runtime, "electron.exe");
            if (!File.Exists(electron))
            {
                MessageBox.Show(
                    "程序包不完整。请重新解压整个 ZIP，不要单独移动 EXE。",
                    "Aethmere Agent Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            var start = new ProcessStartInfo
            {
                FileName = electron,
                WorkingDirectory = runtime,
                UseShellExecute = false,
                CreateNoWindow = true,
                Arguments = "--disable-breakpad --disable-logging " + String.Join(" ", Array.ConvertAll(args, Quote))
            };
            start.EnvironmentVariables.Remove("ELECTRON_ENABLE_LOGGING");
            var logDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Aethmere Agent Studio",
                "logs"
            );
            Directory.CreateDirectory(logDirectory);
            start.EnvironmentVariables["ELECTRON_LOG_FILE"] = Path.Combine(logDirectory, "electron.log");
            start.EnvironmentVariables["CHROME_LOG_FILE"] = Path.Combine(logDirectory, "chromium.log");
            start.EnvironmentVariables["AETHMERE_STUDIO_LAUNCHED"] = "1";
            Process.Start(start);
        }
    }
}
