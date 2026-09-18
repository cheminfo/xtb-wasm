module fmod
  use iso_c_binding
  implicit none
contains
  subroutine fadd(n, x, y, out) bind(C, name="fadd")
    integer(c_int), value :: n
    real(c_double), intent(in) :: x(n), y(n)
    real(c_double), intent(out) :: out(n)
    integer :: i
    do i = 1, n
       out(i) = x(i) + y(i)
    end do
  end subroutine
  real(c_double) function fdot(n, x, y) bind(C, name="fdot")
    integer(c_int), value :: n
    real(c_double), intent(in) :: x(n), y(n)
    fdot = dot_product(x, y)
  end function
end module
