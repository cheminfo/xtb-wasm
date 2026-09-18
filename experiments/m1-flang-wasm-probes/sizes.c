#include <stdio.h>
#include <stdint.h>
int main(void){
  printf("C: sizeof(size_t)=%d sizeof(intptr_t)=%d sizeof(long)=%d sizeof(void*)=%d\n",
    (int)sizeof(size_t),(int)sizeof(intptr_t),(int)sizeof(long),(int)sizeof(void*));
  return 0;
}
