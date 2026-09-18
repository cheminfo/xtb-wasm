#include <stdio.h>
void fadd(int n, const double* x, const double* y, double* out);
double fdot(int n, const double* x, const double* y);
int main(void){
  double x[4]={1,2,3,4}, y[4]={10,20,30,40}, o[4];
  fadd(4,x,y,o);
  printf("fadd: %g %g %g %g\n", o[0],o[1],o[2],o[3]);
  printf("fdot: %g\n", fdot(4,x,y));
  return 0;
}
