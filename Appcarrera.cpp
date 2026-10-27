#include <iostream>
#include <string>
#include <iomanip>
using namespace std;

int main() {
    string nombre;
    int edad;
    double peso, estatura;

    cout << "=== EVALUACION FISICA ===" << endl;

    cout << "Nombre del estudiante: ";
    getline(cin, nombre);

    cout << "Edad (anos): ";
    cin >> edad;

    cout << "Peso (kg): ";
    cin >> peso;

    cout << "Estatura (m, ejemplo 1.70): ";
    cin >> estatura;

    if (edad <= 0 || peso <= 0 || estatura <= 0) {
        cout << "Error: los datos deben ser mayores a cero." << endl;
        return 1;
    }

    // Indice de Masa Corporal
    double imc = peso / (estatura * estatura);
    string categoria;

    if (imc < 18.5)
        categoria = "Bajo peso";
    else if (imc < 25)
        categoria = "Peso normal";
    else if (imc < 30)
        categoria = "Sobrepeso";
    else
        categoria = "Obesidad";

    // Frecuencia cardiaca maxima y zona de entrenamiento (60% - 80%)
    int fcMax = 220 - edad;
    double zonaMin = fcMax * 0.60;
    double zonaMax = fcMax * 0.80;

    cout << fixed << setprecision(1);
    cout << "\n--- RESULTADOS DE " << nombre << " ---" << endl;
    cout << "IMC: " << imc << " (" << categoria << ")" << endl;
    cout << "Frecuencia cardiaca maxima: " << fcMax << " latidos/min" << endl;
    cout << "Zona de entrenamiento: " << zonaMin << " a " << zonaMax
         << " latidos/min" << endl;

    return 0;
}